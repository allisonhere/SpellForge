//! Provider layer for the optional AI assistant. Network code lives only here (never in the webview) and is dormant unless the
//! user enables AI. Local providers are restricted to loopback addresses *by this code*, not by the UI.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Provider {
    pub id: String,
    pub name: String,
    /// `openai-compatible` (Ollama, LM Studio, OpenAI-style APIs). `anthropic` is planned.
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub enabled: bool,
    /// Cloud providers send data off this machine and require explicit consent (not available in this build yet).
    pub cloud: bool,
}
impl Default for Provider {
    fn default() -> Self {
        Self { id: String::new(), name: String::new(), kind: "openai-compatible".into(), base_url: String::new(), model: String::new(), enabled: false, cloud: false }
    }
}

pub fn default_providers() -> Vec<Provider> {
    vec![
        Provider { id: "ollama".into(), name: "Ollama (local)".into(), base_url: "http://127.0.0.1:11434/v1".into(), ..Default::default() },
        Provider { id: "lmstudio".into(), name: "LM Studio (local)".into(), base_url: "http://127.0.0.1:1234/v1".into(), ..Default::default() },
    ]
}

/// Validate and normalise the provider's endpoint. Local providers must resolve to loopback; cloud providers must use https.
pub fn validate_endpoint(p: &Provider) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(p.base_url.trim_end_matches('/')).map_err(|e| format!("invalid endpoint '{}': {e}", p.base_url))?;
    if !matches!(u.scheme(), "http" | "https") { return Err("endpoint must be http or https".into()); }
    if !u.username().is_empty() || u.password().is_some() { return Err("endpoint must not contain credentials".into()); }
    if u.query().is_some() || u.fragment().is_some() { return Err("endpoint must not contain a query or fragment".into()); }
    let host = u.host_str().unwrap_or("");
    if p.cloud {
        if u.scheme() != "https" { return Err("cloud providers must use https".into()); }
        return Ok(u);
    }
    let loopback = match u.host() {
        Some(url::Host::Ipv4(a)) => a.is_loopback(),
        Some(url::Host::Ipv6(a)) => a.is_loopback(),
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        None => false,
    };
    if !loopback { return Err(format!("'{host}' is not a loopback address. Local AI providers may only connect to localhost.")); }
    Ok(u)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

/// Defence in depth: the frontend already screens outgoing text, but a compromised page must not be able to exfiltrate local data.
pub fn forbidden(content: &str) -> Option<&'static str> {
    let l = content.to_ascii_lowercase();
    if l.contains("spellforge-gamedata") || l.contains("wow-ui-source") || l.contains("/.local/share/") { return Some("a local game-data path"); }
    if l.contains("\\addons\\blizzard_") || l.contains("/addons/blizzard_") { return Some("a Blizzard interface source path"); }
    if l.contains("/home/") { return Some("an absolute home-directory path"); }
    if l.contains("sk-ant-") { return Some("something that looks like an API key"); }
    let b = content.as_bytes();
    for i in 0..b.len().saturating_sub(23) {
        if &b[i..i + 3] == b"sk-" && b[i + 3..i + 23].iter().all(|c| c.is_ascii_alphanumeric()) { return Some("something that looks like an API key"); }
    }
    None
}

pub fn check_payload(messages: &[ChatMsg]) -> Result<(), String> {
    for m in messages {
        if let Some(what) = forbidden(&m.content) { return Err(format!("Refusing to send: the request contains {what}.")); }
        if !matches!(m.role.as_str(), "system" | "user" | "assistant") { return Err(format!("invalid message role '{}'", m.role)); }
    }
    if messages.iter().map(|m| m.content.len()).sum::<usize>() > 600_000 { return Err("request is too large".into()); }
    Ok(())
}

pub enum Sse {
    Delta(String),
    Done,
    Ignore,
}

/// Parse one line of an OpenAI-style server-sent-events stream.
pub fn parse_sse_line(line: &str) -> Sse {
    let Some(data) = line.trim().strip_prefix("data:") else { return Sse::Ignore };
    let data = data.trim();
    if data == "[DONE]" { return Sse::Done; }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else { return Sse::Ignore };
    match v["choices"][0]["delta"]["content"].as_str() {
        Some(s) if !s.is_empty() => Sse::Delta(s.to_string()),
        _ => Sse::Ignore,
    }
}

fn client() -> Result<reqwest::Client, String> {
    // No redirects: a local provider must never be bounced to another host.
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(std::time::Duration::from_secs(5)).build().map_err(|e| e.to_string())
}

pub async fn list_models(p: &Provider) -> Result<Vec<String>, String> {
    let base = validate_endpoint(p)?;
    let url = format!("{}/models", base.as_str().trim_end_matches('/'));
    let r = client()?.get(&url).timeout(std::time::Duration::from_secs(8)).send().await.map_err(|e| format!("cannot reach {}: {e}", p.name))?;
    if !r.status().is_success() { return Err(format!("{} answered {}", p.name, r.status())); }
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    let mut names: Vec<String> = v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect();
    names.sort();
    Ok(names)
}

/// Stream a chat completion. `on_delta` receives each text fragment; `cancelled` is polled between chunks. Returns the full text.
pub async fn chat_stream(p: &Provider, messages: &[ChatMsg], mut on_delta: impl FnMut(&str), cancelled: impl Fn() -> bool) -> Result<String, String> {
    let base = validate_endpoint(p)?;
    check_payload(messages)?;
    if p.model.trim().is_empty() { return Err("no model selected for this provider".into()); }
    let url = format!("{}/chat/completions", base.as_str().trim_end_matches('/'));
    let body = serde_json::json!({ "model": p.model, "messages": messages, "stream": true, "temperature": 0.2 });
    let resp = client()?.post(&url).json(&body).timeout(std::time::Duration::from_secs(300)).send().await.map_err(|e| format!("cannot reach {}: {e}", p.name))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("{} answered {st}: {}", p.name, txt.chars().take(300).collect::<String>()));
    }
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();
    while let Some(chunk) = stream.next().await {
        if cancelled() { return Err("cancelled".into()); }
        buf.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| format!("stream error: {e}"))?));
        while let Some(nl) = buf.find('\n') {
            let line: String = buf.drain(..=nl).collect();
            match parse_sse_line(&line) {
                Sse::Delta(d) => { on_delta(&d); full.push_str(&d); }
                Sse::Done => return Ok(full),
                Sse::Ignore => {}
            }
        }
        if full.len() > 400_000 { return Err("reply is unreasonably long; stopped".into()); }
    }
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(url: &str) -> Provider { Provider { id: "t".into(), name: "t".into(), base_url: url.into(), ..Default::default() } }

    #[test]
    fn local_providers_are_loopback_only() {
        for ok in ["http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "http://LOCALHOST:1234/v1", "http://[::1]:8080/v1", "http://127.1.2.3:9/v1"] { assert!(validate_endpoint(&local(ok)).is_ok(), "{ok}"); }
        for bad in ["http://example.com/v1", "http://192.168.1.10:11434/v1", "http://10.0.0.5/v1", "http://127.0.0.1.evil.com/v1", "http://localhost.evil.com/v1", "http://evil.com@127.0.0.1/v1", "http://user:pw@localhost/v1", "http://localhost/v1?x=1", "ftp://localhost/v1", "http://0.0.0.0:1234/v1"] {
            assert!(validate_endpoint(&local(bad)).is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn cloud_requires_https() {
        let c = |u: &str| Provider { cloud: true, ..local(u) };
        assert!(validate_endpoint(&c("https://api.example.com/v1")).is_ok());
        assert!(validate_endpoint(&c("http://api.example.com/v1")).is_err());
    }

    #[test]
    fn payload_guard_blocks_local_data_and_keys() {
        let m = |c: &str| vec![ChatMsg { role: "user".into(), content: c.into() }];
        assert!(check_payload(&m("add a health bar to the party frames")).is_ok());
        for bad in ["/home/allie/Projects/x", "Interface\\AddOns\\Blizzard_SharedXML\\a.lua", "~/.local/share/spellforge-gamedata/ui", "wow-ui-source", "key sk-ant-api03-abcdefghij", "sk-abcdefghijklmnopqrstuvwxyz"] {
            assert!(check_payload(&m(bad)).is_err(), "{bad}");
        }
        assert!(check_payload(&[ChatMsg { role: "tool".into(), content: "x".into() }]).is_err());
    }

    #[test]
    fn parses_sse_lines() {
        assert!(matches!(parse_sse_line(r#"data: {"choices":[{"delta":{"content":"Hel"}}]}"#), Sse::Delta(s) if s == "Hel"));
        assert!(matches!(parse_sse_line("data: [DONE]"), Sse::Done));
        assert!(matches!(parse_sse_line(": keep-alive"), Sse::Ignore));
        assert!(matches!(parse_sse_line(r#"data: {"choices":[{"delta":{}}]}"#), Sse::Ignore));
        assert!(matches!(parse_sse_line("data: not json"), Sse::Ignore));
    }

    /// A throwaway local HTTP server that speaks just enough OpenAI-style SSE, so the client is tested end to end with no network.
    async fn fake_server(response: &'static str) -> u16 {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = l.accept().await {
                let mut b = [0u8; 8192];
                let _ = s.read(&mut b).await;
                let _ = s.write_all(response.as_bytes()).await;
                let _ = s.shutdown().await;
            }
        });
        port
    }

    const SSE: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"{\\\"say\\\":\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"\\\"hi\\\",\\\"actions\\\":[]}\"}}]}\n\ndata: [DONE]\n\n";

    #[tokio::test]
    async fn streams_a_reply_end_to_end() {
        let port = fake_server(SSE).await;
        let p = Provider { model: "m".into(), ..local(&format!("http://127.0.0.1:{port}/v1")) };
        let mut parts = vec![];
        let full = chat_stream(&p, &[ChatMsg { role: "user".into(), content: "x".into() }], |d| parts.push(d.to_string()), || false).await.unwrap();
        assert_eq!(full, r#"{"say":"hi","actions":[]}"#);
        assert_eq!(parts.len(), 2, "deltas are delivered as they arrive");
    }

    #[tokio::test]
    async fn reports_server_errors_and_unreachable_hosts_and_missing_model() {
        let port = fake_server("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\nboom").await;
        let p = Provider { model: "m".into(), ..local(&format!("http://127.0.0.1:{port}/v1")) };
        assert!(chat_stream(&p, &[], |_| {}, || false).await.unwrap_err().contains("500"));
        let dead = Provider { model: "m".into(), ..local("http://127.0.0.1:1/v1") };
        assert!(chat_stream(&dead, &[], |_| {}, || false).await.unwrap_err().contains("cannot reach"));
        assert!(chat_stream(&local("http://127.0.0.1:9/v1"), &[], |_| {}, || false).await.unwrap_err().contains("no model"));
    }

    #[tokio::test]
    async fn cancellation_stops_the_stream() {
        let port = fake_server(SSE).await;
        let p = Provider { model: "m".into(), ..local(&format!("http://127.0.0.1:{port}/v1")) };
        assert_eq!(chat_stream(&p, &[], |_| {}, || true).await.unwrap_err(), "cancelled");
    }

    #[tokio::test]
    async fn redirects_are_not_followed() {
        let port = fake_server("HTTP/1.1 302 Found\r\nLocation: http://example.com/\r\nConnection: close\r\n\r\n").await;
        let p = Provider { model: "m".into(), ..local(&format!("http://127.0.0.1:{port}/v1")) };
        assert!(chat_stream(&p, &[], |_| {}, || false).await.unwrap_err().contains("302"));
    }
}
