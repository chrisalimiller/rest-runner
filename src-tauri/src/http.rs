//! Sends HTTP requests for the web view, so calls are not limited by browser CORS rules.
//!
//! Redirects are not followed here: `sendRequest` in src/lib/http.ts follows them
//! one hop at a time so each hop can be matched on its own.

use std::{
    collections::HashMap,
    error::Error,
    sync::Mutex,
    time::{Duration, Instant},
};

use reqwest::{redirect::Policy, Client, Method};
use serde::{Deserialize, Serialize};
use tokio::task::AbortHandle;

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
    client: Client,
    in_flight: Mutex<HashMap<String, AbortHandle>>,
}

impl HttpState {
    pub fn new() -> Result<Self, String> {
        let client = Client::builder()
            .redirect(Policy::none())
            .build()
            .map_err(|e| format!("Could not start the HTTP client: {}", describe(&e)))?;
        Ok(Self { client, in_flight: Mutex::new(HashMap::new()) })
    }

    pub async fn send(&self, req: HttpRequest) -> Result<HttpResponse, String> {
        let id = req.id.clone();
        let task = tokio::spawn(perform(self.client.clone(), req));
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
        }
    }

    #[tokio::test]
    async fn returns_status_headers_and_body() {
        let url = serve("HTTP/1.1 201 Created\r\nX-Test: yes\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhéllo", 0).await;
        let state = HttpState::new().unwrap();
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
        let state = HttpState::new().unwrap();
        let res = state.send(request(&url)).await.unwrap();
        assert_eq!(res.status, 302);
        assert!(res.headers.contains(&("location".to_string(), "/next".to_string())));
    }

    #[tokio::test]
    async fn cancel_aborts_a_slow_call() {
        let url = serve("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", 5000).await;
        let state = std::sync::Arc::new(HttpState::new().unwrap());
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
        let state = HttpState::new().unwrap();
        let mut req = request(&url);
        req.timeout_ms = Some(100);
        assert!(state.send(req).await.is_err());
    }

    #[tokio::test]
    async fn reports_why_a_connection_failed() {
        let state = HttpState::new().unwrap();
        let err = state.send(request("http://127.0.0.1:1/")).await.unwrap_err();
        assert!(err.contains("error sending request"), "{err}");
        assert!(err.len() > "error sending request".len() + 10, "{err}");
    }
}
