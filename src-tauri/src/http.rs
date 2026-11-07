//! Sends HTTP requests for the web view, so calls are not limited by browser CORS rules.
//!
//! Redirects are not followed here: `sendRequest` in src/lib/http.ts follows them
//! one hop at a time so each hop can be matched on its own.

use std::{
    collections::HashMap,
    error::Error,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use reqwest::{redirect::Policy, Client, Identity, Method};
use serde::{Deserialize, Serialize};
use tokio::task::AbortHandle;

use crate::certs::CertStore;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    /// Chosen by the caller so it can cancel the call with `HttpState::cancel`.
    pub id: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    /// No limit when missing, as before.
    pub timeout_ms: Option<u64>,
    /// Maximum decoded body bytes; independently validated at the native boundary.
    pub max_response_bytes: Option<usize>,
    /// Which imported certificates this call uses. Chosen by the caller (see src/lib/certificates.ts).
    #[serde(default)]
    pub tls: TlsSpec,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TlsSpec {
    /// Client certificate to present.
    pub cert_id: Option<String>,
    /// Extra trusted roots, added to the system ones.
    #[serde(default)]
    pub ca_ids: Vec<String>,
    /// Trust only `ca_ids`, not the system roots.
    #[serde(default)]
    pub ca_only: bool,
}

impl TlsSpec {
    fn cache_key(&self) -> String {
        let mut cas = self.ca_ids.clone();
        cas.sort();
        format!("{}|{}|{}", self.cert_id.as_deref().unwrap_or(""), cas.join(","), self.ca_only)
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub size_bytes: usize,
    pub duration_ms: u64,
    /// Headers this app added because the request had none of its own (User-Agent, Accept), so reports can list what was really sent.
    pub added_headers: Vec<(String, String)>,
}

pub const CANCELLED: &str = "Request cancelled";
const DEFAULT_RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
const MAX_RESPONSE_LIMIT: usize = 16 * 1024 * 1024;

/// Sent when the request has no User-Agent of its own. Many firewalls and CDNs answer 403 to
/// requests without one, and Postman and curl always send one.
const DEFAULT_USER_AGENT: &str = concat!("RestRunner/", env!("CARGO_PKG_VERSION"));

/// Headers added when the request does not set them, like Postman and curl do.
/// Accept-Encoding is added by reqwest itself.
fn default_headers(headers: &[(String, String)]) -> Vec<(&'static str, &'static str)> {
    let has = |wanted: &str| headers.iter().any(|(name, _)| name.trim().eq_ignore_ascii_case(wanted));
    let mut extra = Vec::new();
    if !has("user-agent") {
        extra.push(("User-Agent", DEFAULT_USER_AGENT));
    }
    if !has("accept") {
        extra.push(("Accept", "*/*"));
    }
    extra
}

pub struct HttpState {
    certs: Arc<CertStore>,
    /// One client per TLS setup, so a batch against one host reuses its connections and handshakes.
    clients: Mutex<HashMap<String, Client>>,
    in_flight: Mutex<HashMap<String, AbortHandle>>,
    response_slots: tokio::sync::Semaphore,
}

impl HttpState {
    pub fn new(certs: Arc<CertStore>) -> Self {
        Self { certs, clients: Mutex::new(HashMap::new()), in_flight: Mutex::new(HashMap::new()), response_slots: tokio::sync::Semaphore::new(4) }
    }

    /// Forgets built clients. Call after a certificate changes or is deleted.
    pub fn clear_clients(&self) {
        self.clients.lock().unwrap().clear();
    }

    fn client_for(&self, tls: &TlsSpec) -> Result<Client, String> {
        let key = tls.cache_key();
        if let Some(client) = self.clients.lock().unwrap().get(&key) {
            return Ok(client.clone());
        }
        let mut builder = Client::builder().redirect(Policy::none());
        if let Some(id) = &tls.cert_id {
            let identity = Identity::from_pem(&self.certs.identity_pem(id)?)
                .map_err(|e| format!("Could not use the client certificate: {}", describe(&e)))?;
            builder = builder.identity(identity);
        }
        if tls.ca_only && !tls.ca_ids.is_empty() {
            builder = builder.tls_built_in_root_certs(false);
        }
        for id in &tls.ca_ids {
            let roots = reqwest::Certificate::from_pem_bundle(&self.certs.ca_pem(id)?)
                .map_err(|e| format!("Could not use the CA certificate: {}", describe(&e)))?;
            for root in roots {
                builder = builder.add_root_certificate(root);
            }
        }
        let client = builder
            .build()
            .map_err(|e| format!("Could not start the HTTP client: {}", describe(&e)))?;
        self.clients.lock().unwrap().insert(key, client.clone());
        Ok(client)
    }

    pub async fn send(self: &Arc<Self>, req: HttpRequest) -> Result<HttpResponse, String> {
        let id = req.id.clone();
        let this = self.clone();
        let task = tokio::spawn(async move {
            let _slot = this.response_slots.acquire().await.map_err(|_| "HTTP service stopped".to_string())?;
            // Building a client reads files and the keychain, which can block.
            let tls = req.tls.clone();
            let client_state = this.clone();
            let client = tokio::task::spawn_blocking(move || client_state.client_for(&tls))
                .await
                .map_err(|e| format!("The request stopped unexpectedly: {e}"))??;
            perform(client, req).await
        });
        self.in_flight.lock().unwrap().insert(id.clone(), task.abort_handle());
        let joined = task.await;
        self.in_flight.lock().unwrap().remove(&id);
        match joined {
            Ok(result) => result,
            Err(e) if e.is_cancelled() => Err(CANCELLED.to_string()),
            Err(e) => Err(format!("The request stopped unexpectedly: {e}")),
        }
    }

    /// Aborts a call in flight. Does nothing when it already finished.
    pub fn cancel(&self, id: &str) {
        if let Some(handle) = self.in_flight.lock().unwrap().remove(id) {
            handle.abort();
        }
    }
}

async fn perform(client: Client, req: HttpRequest) -> Result<HttpResponse, String> {
    let start = Instant::now();
    let limit = req.max_response_bytes.unwrap_or(DEFAULT_RESPONSE_LIMIT);
    if !(1..=MAX_RESPONSE_LIMIT).contains(&limit) {
        return Err(format!("Response limit must be between 1 and {MAX_RESPONSE_LIMIT} bytes"));
    }
    let method = Method::from_bytes(req.method.as_bytes())
        .map_err(|_| format!("Invalid HTTP method: {}", req.method))?;
    let mut builder = client.request(method, &req.url);
    let added = default_headers(&req.headers);
    for (name, value) in &added {
        builder = builder.header(*name, *value);
    }
    for (name, value) in &req.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    if let Some(ms) = req.timeout_ms {
        builder = builder.timeout(Duration::from_millis(ms));
    }
    let mut res = builder.send().await.map_err(|e| describe(&e))?;
    let status = res.status();
    let headers = res
        .headers()
        .iter()
        .map(|(name, value)| (name.to_string(), String::from_utf8_lossy(value.as_bytes()).into_owned()))
        .collect();
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| describe(&e))? {
        if chunk.len() > limit - bytes.len() {
            return Err(format!("Response exceeded {limit} bytes"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
        size_bytes: bytes.len(),
        duration_ms: start.elapsed().as_millis() as u64,
        added_headers: added.iter().map(|(n, v)| (n.to_string(), v.to_string())).collect(),
    })
}

/// The error and its causes on one line, since reqwest's own message hides the reason.
fn describe(err: &reqwest::Error) -> String {
    let mut text = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    /// Answers every connection with `response` once the request headers arrive.
    async fn serve(response: &'static str, delay_ms: u64) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let _ = socket.read(&mut buf).await;
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        format!("http://{addr}/")
    }

    fn request(url: &str) -> HttpRequest {
        HttpRequest {
            id: "t1".into(),
            method: "GET".into(),
            url: url.into(),
            headers: vec![],
            body: None,
            timeout_ms: None,
            max_response_bytes: None,
            tls: TlsSpec::default(),
        }
    }

    pub(crate) fn plain_state() -> Arc<HttpState> {
        use crate::certs::PassphraseStore;
        struct None_;
        impl PassphraseStore for None_ {
            fn get(&self, _: &str) -> Option<String> {
                None
            }
            fn set(&self, _: &str, _: &str) -> Result<(), String> {
                Ok(())
            }
            fn delete(&self, _: &str) {}
        }
        Arc::new(HttpState::new(Arc::new(CertStore::new(std::env::temp_dir().join("rr-none"), Arc::new(None_)))))
    }

    #[tokio::test]
    async fn response_limit_counts_streamed_bytes() {
        for (wire, expected) in [
            ("HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nabcd", true),
            ("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nabcde", true),
            ("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nabcdef", false),
            ("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n3\r\ndef\r\n0\r\n\r\n", false),
        ] {
            let url = serve(wire, 0).await;
            let mut req = request(&url);
            req.max_response_bytes = Some(5);
            let result = plain_state().send(req).await;
            assert_eq!(result.is_ok(), expected, "{result:?}");
            if !expected { assert_eq!(result.unwrap_err(), "Response exceeded 5 bytes"); }
        }
    }

    #[tokio::test]
    async fn response_limit_counts_decompressed_bytes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 1024];
            let _ = socket.read(&mut request).await;
            let body: &[u8] = &[31, 139, 8, 0, 0, 0, 0, 0, 2, 255, 75, 76, 74, 78, 73, 77, 75, 207, 200, 204, 2, 0, 58, 112, 129, 57, 10, 0, 0, 0];
            let header = format!("HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = socket.write_all(header.as_bytes()).await;
            let _ = socket.write_all(body).await;
        });
        let mut req = request(&format!("http://{addr}/"));
        req.max_response_bytes = Some(5);
        assert_eq!(plain_state().send(req).await.unwrap_err(), "Response exceeded 5 bytes");
    }

    #[tokio::test]
    async fn returns_status_headers_and_body() {
        let url = serve("HTTP/1.1 201 Created\r\nX-Test: yes\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhéllo", 0).await;
        let state = plain_state();
        let res = state.send(request(&url)).await.unwrap();
        assert_eq!(res.status, 201);
        assert_eq!(res.status_text, "Created");
        assert!(res.headers.contains(&("x-test".to_string(), "yes".to_string())));
        assert_eq!(res.body, "héll"); // Content-Length 5 counts the two bytes of é
        assert_eq!(res.size_bytes, 5);
    }

    /// Answers with the request it received, so a test can read the headers that were sent.
    async fn echo() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            let body = String::from_utf8_lossy(&buf[..n]).into_owned();
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = socket.write_all(reply.as_bytes()).await;
        });
        format!("http://{addr}/")
    }

    #[tokio::test]
    async fn sends_default_user_agent_and_accept() {
        let url = echo().await;
        let res = plain_state().send(request(&url)).await.unwrap();
        let sent = res.body.to_lowercase();
        assert!(sent.contains("user-agent: restrunner/"), "{sent}");
        assert!(sent.contains("accept: */*"), "{sent}");
        let names: Vec<&str> = res.added_headers.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["User-Agent", "Accept"]);
        assert!(res.added_headers[0].1.starts_with("RestRunner/"));
        assert_eq!(res.added_headers[1].1, "*/*");
    }

    #[tokio::test]
    async fn keeps_the_callers_user_agent_and_accept() {
        let url = echo().await;
        let mut req = request(&url);
        req.headers = vec![("user-agent".into(), "Mine/1".into()), ("Accept".into(), "application/json".into())];
        let res = plain_state().send(req).await.unwrap();
        let sent = res.body.to_lowercase();
        assert!(sent.contains("user-agent: mine/1"), "{sent}");
        assert!(!sent.contains("restrunner"), "{sent}");
        assert_eq!(sent.matches("accept:").count(), 1, "{sent}");
        assert!(sent.contains("accept: application/json"), "{sent}");
        assert!(res.added_headers.is_empty());
    }

    #[tokio::test]
    async fn does_not_follow_redirects() {
        let url = serve("HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", 0).await;
        let state = plain_state();
        let res = state.send(request(&url)).await.unwrap();
        assert_eq!(res.status, 302);
        assert!(res.headers.contains(&("location".to_string(), "/next".to_string())));
    }

    #[tokio::test]
    async fn cancel_aborts_a_slow_call() {
        let url = serve("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", 5000).await;
        let state = plain_state();
        let running = {
            let state = state.clone();
            tokio::spawn(async move { state.send(request(&url)).await })
        };
        tokio::time::sleep(Duration::from_millis(200)).await;
        state.cancel("t1");
        assert_eq!(running.await.unwrap().unwrap_err(), CANCELLED);
    }

    #[tokio::test]
    async fn times_out() {
        let url = serve("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", 5000).await;
        let state = plain_state();
        let mut req = request(&url);
        req.timeout_ms = Some(100);
        assert!(state.send(req).await.is_err());
    }

    #[tokio::test]
    async fn reports_why_a_connection_failed() {
        let state = plain_state();
        let err = state.send(request("http://127.0.0.1:1/")).await.unwrap_err();
        assert!(err.contains("error sending request"), "{err}");
        assert!(err.len() > "error sending request".len() + 10, "{err}");
    }
}
