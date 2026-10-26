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
}

pub const CANCELLED: &str = "Request cancelled";

pub struct HttpState {
    certs: Arc<CertStore>,
    /// One client per TLS setup, so a batch against one host reuses its connections and handshakes.
    clients: Mutex<HashMap<String, Client>>,
    in_flight: Mutex<HashMap<String, AbortHandle>>,
}

impl HttpState {
    pub fn new(certs: Arc<CertStore>) -> Self {
        Self { certs, clients: Mutex::new(HashMap::new()), in_flight: Mutex::new(HashMap::new()) }
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
            // Building a client reads files and the keychain, which can block.
            let tls = req.tls.clone();
            let client = tokio::task::spawn_blocking(move || this.client_for(&tls))
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
    let method = Method::from_bytes(req.method.as_bytes())
        .map_err(|_| format!("Invalid HTTP method: {}", req.method))?;
    let mut builder = client.request(method, &req.url);
    for (name, value) in &req.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    if let Some(ms) = req.timeout_ms {
        builder = builder.timeout(Duration::from_millis(ms));
    }
    let res = builder.send().await.map_err(|e| describe(&e))?;
    let status = res.status();
    let headers = res
        .headers()
        .iter()
        .map(|(name, value)| (name.to_string(), String::from_utf8_lossy(value.as_bytes()).into_owned()))
        .collect();
    let bytes = res.bytes().await.map_err(|e| describe(&e))?;
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
        size_bytes: bytes.len(),
        duration_ms: start.elapsed().as_millis() as u64,
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
