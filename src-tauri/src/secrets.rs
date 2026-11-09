//! Secret environment variable values, kept in the OS keychain instead of localStorage.
//!
//! Each environment's values are one JSON string (variable id -> value). Credential stores limit
//! the size of one item (Windows Credential Manager: 2560 bytes, stored as UTF-16 by `keyring`), so
//! the JSON is split into chunks, with a header item holding the chunk count and an integrity check.
//! `secrets:index` lists the ids that have secrets.
//!
//! Account names (collision-free, versioned):
//! - id made only of `[A-Za-z0-9_-]`: header `secrets:env:{id}`, chunks `secrets:env:{id}:{n}`
//!   (unchanged from the first version, so existing items stay readable).
//! - any other id: the id is percent-encoded (every byte outside `[A-Za-z0-9_-]`, including `%`,
//!   becomes `%XX` with uppercase hex), header `secrets:env2:{enc}`, chunks `secrets:env2:{enc}:{n}`.
//!   An encoded id never contains ':', so no header can equal another environment's chunk account,
//!   and the two prefixes never overlap.
//! - Legacy fallback: items written for an unsafe id by the first version used `secrets:env:{id}`.
//!   They are read only if no `env2` header exists and the legacy header is a bare integer (an
//!   environment's chunk is a JSON object, so another environment's chunk is never mistaken for one).
//!   The next write moves the value to the new accounts and deletes the legacy items.
//!
//! Header: legacy `"{count}"`, or `"2:{count}:{total_bytes}:{fnv1a64 hex}"`. The header is written last,
//! so a crash during a rewrite leaves chunks that do not match it; `read_env` then fails instead of
//! returning mixed data. Legacy headers (count only) are accepted without a check.
//! Unlike the certificate passphrases, reads report locked or denied keychains instead of hiding them.

use std::{fmt, sync::Arc, sync::Mutex};

#[cfg(any(target_os = "macos", target_os = "windows"))]
const SERVICE: &str = "rest-runner";
const INDEX_ACCOUNT: &str = "secrets:index";
/// Max UTF-8 bytes per chunk. Windows Credential Manager limits a credential blob to 2560 bytes and the
/// keyring crate stores the value as UTF-16 (2 bytes per unit). A UTF-8 byte never costs more than one UTF-16
/// unit, so 1200 bytes is at most 1200 units = 2400 bytes, under the limit. (1800 would be up to 3600 bytes.)
const CHUNK_BYTES: usize = 1200;
/// Raw id limit in bytes. Encoded, an account is at most about 3 * 200 + 20 chars, well under keychain limits.
const MAX_ID_LEN: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub struct SecretError(pub String);

impl fmt::Display for SecretError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A flat account -> text store. The OS keychain in the app; a map in tests.
/// `get` returns `Ok(None)` only when the item does not exist; any other failure is an `Err`.
pub trait SecretBackend: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError>;
    fn set(&self, account: &str, value: &str) -> Result<(), SecretError>;
    /// Deleting a missing item succeeds.
    fn delete(&self, account: &str) -> Result<(), SecretError>;
}

/// macOS Keychain and Windows Credential Manager, through the `keyring` crate.
/// On any other platform every call fails: `keyring` would fall back to a mock store that reports
/// success and loses the data at exit.
pub struct KeyringBackend;

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl KeyringBackend {
    fn entry(account: &str) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(SERVICE, account).map_err(|e| map_err("open the system keychain", e))
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn map_err(action: &str, e: keyring::Error) -> SecretError {
    let why = match &e {
        keyring::Error::NoStorageAccess(_) => "the keychain is locked or access was denied".to_string(),
        keyring::Error::TooLong(..) => "the value is too large for the keychain".to_string(),
        other => other.to_string(),
    };
    SecretError(format!("Could not {action}: {why}"))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl SecretBackend for KeyringBackend {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
        match Self::entry(account)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(map_err("read from the system keychain", e)),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), SecretError> {
        Self::entry(account)?
            .set_password(value)
            .map_err(|e| map_err("save to the system keychain", e))
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(map_err("delete from the system keychain", e)),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn unsupported() -> SecretError {
    SecretError("The system keychain isn't supported on this platform".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl SecretBackend for KeyringBackend {
    fn get(&self, _account: &str) -> Result<Option<String>, SecretError> {
        Err(unsupported())
    }
    fn set(&self, _account: &str, _value: &str) -> Result<(), SecretError> {
        Err(unsupported())
    }
    fn delete(&self, _account: &str) -> Result<(), SecretError> {
        Err(unsupported())
    }
}

/// Chunking, header and index logic over any backend.
pub struct SecretStore<B: SecretBackend> {
    backend: B,
    /// Serializes writes so the index and headers are not updated by two calls at once.
    lock: Mutex<()>,
}

fn is_safe_id(id: &str) -> bool {
    id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn encode_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for b in id.bytes() {
        if b.is_ascii_alphanumeric() || b == b'_' || b == b'-' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `legacy` selects the first-version name (`secrets:env:{raw id}`); for safe ids both are the same.
fn header_account(id: &str, legacy: bool) -> String {
    if legacy || is_safe_id(id) {
        format!("secrets:env:{id}")
    } else {
        format!("secrets:env2:{}", encode_id(id))
    }
}

fn chunk_account(id: &str, n: usize, legacy: bool) -> String {
    format!("{}:{n}", header_account(id, legacy))
}

/// 64-bit FNV-1a, a cheap integrity check (not a security measure).
fn fnv1a64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[derive(Debug, Clone, Copy)]
struct Header {
    count: usize,
    /// (total bytes, fnv1a64); None for legacy count-only headers.
    check: Option<(usize, u64)>,
    /// Stored under the first-version account names of an unsafe id.
    legacy: bool,
}

impl Header {
    fn encode(count: usize, json: &str) -> String {
        format!("2:{count}:{}:{:016x}", json.len(), fnv1a64(json))
    }

    fn parse(h: &str, legacy: bool) -> Option<Header> {
        let h = h.trim();
        if let Ok(count) = h.parse::<usize>() {
            return Some(Header { count, check: None, legacy });
        }
        let mut p = h.split(':');
        if p.next()? != "2" {
            return None;
        }
        let count = p.next()?.parse().ok()?;
        let len = p.next()?.parse().ok()?;
        let hash = u64::from_str_radix(p.next()?, 16).ok()?;
        if p.next().is_some() {
            return None;
        }
        Some(Header { count, check: Some((len, hash)), legacy })
    }
}

pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("The environment id is empty.".into());
    }
    if id.len() > MAX_ID_LEN {
        return Err("The environment id is too long.".into());
    }
    if id.chars().any(|c| c.is_control()) {
        return Err("The environment id contains control characters.".into());
    }
    Ok(())
}

/// Splits on char boundaries into pieces of at most `max` bytes. Always returns at least one piece.
pub fn split_chunks(s: &str, max: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = s;
    while rest.len() > max {
        let mut cut = max;
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        let (head, tail) = rest.split_at(cut);
        out.push(head);
        rest = tail;
    }
    out.push(rest);
    out
}

impl<B: SecretBackend> SecretStore<B> {
    pub fn new(backend: B) -> Self {
        Self { backend, lock: Mutex::new(()) }
    }

    /// Finds the header: the current account first, then (unsafe ids only) a legacy count-only header.
    fn load_header(&self, id: &str) -> Result<Option<Header>, SecretError> {
        if let Some(h) = self.backend.get(&header_account(id, false))? {
            return Header::parse(&h, false).map(Some).ok_or_else(|| {
                SecretError(format!("The stored secrets for environment {id} are damaged (bad header)."))
            });
        }
        if is_safe_id(id) {
            return Ok(None);
        }
        match self.backend.get(&header_account(id, true))? {
            Some(h) => Ok(h.trim().parse::<usize>().ok().map(|count| Header { count, check: None, legacy: true })),
            None => Ok(None),
        }
    }

    pub fn read_env(&self, id: &str) -> Result<Option<String>, SecretError> {
        validate_id(id).map_err(SecretError)?;
        let Some(h) = self.load_header(id)? else { return Ok(None) };
        let mut out = String::new();
        for n in 0..h.count {
            match self.backend.get(&chunk_account(id, n, h.legacy))? {
                Some(c) => out.push_str(&c),
                None => {
                    return Err(SecretError(format!(
                        "The stored secrets for environment {id} are damaged (missing part {n} of {}).",
                        h.count
                    )))
                }
            }
        }
        if let Some((len, hash)) = h.check {
            if out.len() != len || fnv1a64(&out) != hash {
                return Err(SecretError(format!(
                    "The stored secrets for environment {id} are damaged (the parts do not match, possibly an interrupted save)."
                )));
            }
        }
        Ok(Some(out))
    }

    pub fn write_env(&self, id: &str, json: &str) -> Result<(), SecretError> {
        validate_id(id).map_err(SecretError)?;
        if json.is_empty() {
            return Err(SecretError("There are no secret values to save.".into()));
        }
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let existing = self.load_header(id).ok().flatten();
        // Chunk count under the current names, so stale ones can be removed and a failure restored.
        let old_count = match existing {
            Some(h) if !h.legacy => h.count,
            _ => 0,
        };
        // Old chunk texts, so a failed write can put them back and the previous value stays readable.
        let old: Vec<Option<String>> =
            (0..old_count).map(|n| self.backend.get(&chunk_account(id, n, false)).ok().flatten()).collect();
        let chunks = split_chunks(json, CHUNK_BYTES);
        for (n, chunk) in chunks.iter().enumerate() {
            if let Err(e) = self.backend.set(&chunk_account(id, n, false), chunk) {
                // Chunks 0..=n may have been overwritten; restore them. The header was not touched.
                self.restore_chunks(id, &old, n + 1);
                return Err(SecretError(format!(
                    "Could not save secret values (part {} of {}): {e}",
                    n + 1,
                    chunks.len()
                )));
            }
        }
        if let Err(e) = self.backend.set(&header_account(id, false), &Header::encode(chunks.len(), json)) {
            // The old header still describes the old value, so put its chunks back.
            self.restore_chunks(id, &old, chunks.len());
            return Err(SecretError(format!("Could not save secret values: {e}")));
        }
        for n in chunks.len()..old_count {
            self.backend.delete(&chunk_account(id, n, false))?;
        }
        if let Some(h) = existing.filter(|h| h.legacy) {
            // Migrated: remove the first-version items (the header was a bare integer, so it is ours).
            self.backend.delete(&header_account(id, true))?;
            for n in 0..h.count {
                self.backend.delete(&chunk_account(id, n, true))?;
            }
        }
        // A damaged index is rebuilt here: it restarts from this id.
        self.index_update(|ids| {
            if !ids.iter().any(|i| i == id) {
                ids.push(id.to_string());
            }
        })
    }

    /// Puts the first `upto` chunks back to their old text (or removes them if they did not exist).
    fn restore_chunks(&self, id: &str, old: &[Option<String>], upto: usize) {
        for m in 0..upto {
            let _ = match old.get(m).cloned().flatten() {
                Some(prev) => self.backend.set(&chunk_account(id, m, false), &prev),
                None => self.backend.delete(&chunk_account(id, m, false)),
            };
        }
    }

    pub fn delete_env(&self, id: &str) -> Result<(), SecretError> {
        validate_id(id).map_err(SecretError)?;
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        // Header first: with no header the environment reads as absent even if a chunk delete fails.
        let current = self.backend.get(&header_account(id, false))?.and_then(|h| Header::parse(&h, false));
        let legacy = if is_safe_id(id) {
            None
        } else {
            self.backend.get(&header_account(id, true))?.and_then(|h| h.trim().parse::<usize>().ok())
        };
        self.backend.delete(&header_account(id, false))?;
        if let Some(h) = current {
            for n in 0..h.count {
                self.backend.delete(&chunk_account(id, n, false))?;
            }
        }
        if let Some(count) = legacy {
            self.backend.delete(&header_account(id, true))?;
            for n in 0..count {
                self.backend.delete(&chunk_account(id, n, true))?;
            }
        }
        self.index_update(|ids| ids.retain(|i| i != id))
    }

    /// Errors when the index is damaged; saving any environment rebuilds it.
    pub fn list_envs(&self) -> Result<Vec<String>, SecretError> {
        match self.index_read()? {
            (ids, false) => Ok(ids),
            (_, true) => Err(SecretError(
                "The stored secrets index is damaged. Saving a secret rebuilds it; secrets may be missing from lists until then."
                    .into(),
            )),
        }
    }

    /// A cheap probe: succeeds when the keychain can be read. A damaged index does not count as failure.
    pub fn available(&self) -> Result<(), SecretError> {
        self.backend.get(INDEX_ACCOUNT).map(|_| ())
    }

    /// The ids in the index, and whether the index was damaged (then the list is empty).
    fn index_read(&self) -> Result<(Vec<String>, bool), SecretError> {
        match self.backend.get(INDEX_ACCOUNT)? {
            None => Ok((Vec::new(), false)),
            Some(s) => match serde_json::from_str::<Vec<String>>(&s) {
                Ok(ids) => Ok((ids, false)),
                Err(_) => Ok((Vec::new(), true)),
            },
        }
    }

    fn index_update(&self, f: impl FnOnce(&mut Vec<String>)) -> Result<(), SecretError> {
        let (mut ids, damaged) = self.index_read()?;
        let before = ids.clone();
        f(&mut ids);
        if ids == before && !damaged {
            return Ok(());
        }
        if ids.is_empty() {
            return self.backend.delete(INDEX_ACCOUNT);
        }
        let json = serde_json::to_string(&ids).map_err(|e| SecretError(e.to_string()))?;
        self.backend.set(INDEX_ACCOUNT, &json)
    }
}

pub type SharedSecrets = Arc<SecretStore<KeyringBackend>>;

pub fn new_shared() -> SharedSecrets {
    Arc::new(SecretStore::new(KeyringBackend))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    #[derive(Default)]
    struct Fake {
        map: Mutex<HashMap<String, String>>,
        fail_set: Mutex<HashSet<String>>,
        fail_get: Mutex<HashSet<String>>,
    }

    impl SecretBackend for Fake {
        fn get(&self, a: &str) -> Result<Option<String>, SecretError> {
            if self.fail_get.lock().unwrap().contains(a) {
                return Err(SecretError("locked".into()));
            }
            Ok(self.map.lock().unwrap().get(a).cloned())
        }
        fn set(&self, a: &str, v: &str) -> Result<(), SecretError> {
            if self.fail_set.lock().unwrap().contains(a) {
                return Err(SecretError("denied".into()));
            }
            self.map.lock().unwrap().insert(a.into(), v.into());
            Ok(())
        }
        fn delete(&self, a: &str) -> Result<(), SecretError> {
            self.map.lock().unwrap().remove(a);
            Ok(())
        }
    }

    fn store() -> SecretStore<Fake> {
        SecretStore::new(Fake::default())
    }

    fn keys(s: &SecretStore<Fake>) -> Vec<String> {
        let mut k: Vec<_> = s.backend.map.lock().unwrap().keys().cloned().collect();
        k.sort();
        k
    }

    #[test]
    fn round_trip_and_missing() {
        let s = store();
        assert_eq!(s.read_env("a").unwrap(), None);
        s.write_env("a", r#"{"v1":"x"}"#).unwrap();
        assert_eq!(s.read_env("a").unwrap().as_deref(), Some(r#"{"v1":"x"}"#));
        assert!(s.backend.get("secrets:env:a").unwrap().unwrap().starts_with("2:1:10:"));
    }

    #[test]
    fn chunk_boundaries() {
        for len in [1199, 1200, 1201, 2400, 2401] {
            let s = store();
            let v = "a".repeat(len);
            s.write_env("e", &v).unwrap();
            let expect = len.div_ceil(1200);
            assert!(s.backend.get("secrets:env:e").unwrap().unwrap().starts_with(&format!("2:{expect}:")));
            assert_eq!(s.read_env("e").unwrap().unwrap(), v);
        }
    }

    #[test]
    fn multibyte_straddling_boundary() {
        for ch in ["€", "😀"] {
            let s = store();
            let v = format!("{}{}{}", "a".repeat(1199), ch, "b".repeat(10));
            s.write_env("e", &v).unwrap();
            assert_eq!(s.read_env("e").unwrap().unwrap(), v);
            let c0 = s.backend.get("secrets:env:e:0").unwrap().unwrap();
            assert!(c0.len() <= 1200);
        }
        let all = "€".repeat(2000);
        for c in split_chunks(&all, 1200) {
            assert!(c.len() <= 1200);
        }
        let s = store();
        s.write_env("e", &all).unwrap();
        assert_eq!(s.read_env("e").unwrap().unwrap(), all);
    }

    #[test]
    fn shrinking_deletes_stale_chunks() {
        let s = store();
        s.write_env("e", &"a".repeat(5000)).unwrap();
        assert!(keys(&s).contains(&"secrets:env:e:2".to_string()));
        s.write_env("e", "{}").unwrap();
        assert_eq!(s.read_env("e").unwrap().as_deref(), Some("{}"));
        assert!(!keys(&s).contains(&"secrets:env:e:1".to_string()));
        assert!(!keys(&s).contains(&"secrets:env:e:2".to_string()));
    }

    #[test]
    fn errors_are_not_swallowed() {
        let s = store();
        s.write_env("e", "{}").unwrap();
        s.backend.fail_get.lock().unwrap().insert("secrets:env:e".into());
        assert!(s.read_env("e").is_err());
        s.backend.fail_get.lock().unwrap().clear();
        s.backend.fail_get.lock().unwrap().insert("secrets:index".into());
        assert!(s.available().is_err());
        assert!(s.list_envs().is_err());
        assert!(s.write_env("f", "{}").is_err());
        s.backend.fail_get.lock().unwrap().clear();
        s.backend.map.lock().unwrap().remove("secrets:env:e:0");
        assert!(s.read_env("e").unwrap_err().0.contains("damaged"));
    }

    #[test]
    fn failed_write_keeps_previous_value() {
        let s = store();
        let old = "o".repeat(4000);
        s.write_env("e", &old).unwrap();
        // Fails on the second chunk, after the first was already overwritten.
        s.backend.fail_set.lock().unwrap().insert("secrets:env:e:1".into());
        assert!(s.write_env("e", &"n".repeat(4000)).is_err());
        s.backend.fail_set.lock().unwrap().clear();
        assert_eq!(s.read_env("e").unwrap().unwrap(), old);
        // A failing header update also keeps the old value (chunk 0 of the new value is shorter, so
        // the old text is only readable if it was restored; here the header is the failure point).
        s.backend.fail_set.lock().unwrap().insert("secrets:env:e".into());
        assert!(s.write_env("e", &"p".repeat(4000)).is_err());
        s.backend.fail_set.lock().unwrap().clear();
        assert_eq!(s.read_env("e").unwrap().unwrap().len(), 4000);
    }

    #[test]
    fn failed_first_write_leaves_nothing() {
        let s = store();
        s.backend.fail_set.lock().unwrap().insert("secrets:env:e:1".into());
        assert!(s.write_env("e", &"n".repeat(4000)).is_err());
        assert_eq!(s.read_env("e").unwrap(), None);
        assert!(keys(&s).is_empty());
    }

    #[test]
    fn index_and_delete() {
        let s = store();
        s.available().unwrap();
        assert!(s.list_envs().unwrap().is_empty());
        s.write_env("a", "{}").unwrap();
        s.write_env("b", &"x".repeat(4000)).unwrap();
        s.write_env("a", "{\"k\":1}").unwrap();
        assert_eq!(s.list_envs().unwrap(), vec!["a", "b"]);
        s.delete_env("b").unwrap();
        s.delete_env("b").unwrap();
        assert_eq!(s.list_envs().unwrap(), vec!["a"]);
        assert_eq!(s.read_env("b").unwrap(), None);
        s.delete_env("a").unwrap();
        assert!(keys(&s).is_empty());
    }

    #[test]
    fn id_validation() {
        let s = store();
        assert!(s.write_env("", "{}").is_err());
        assert!(s.write_env("a\nb", "{}").is_err());
        assert!(s.read_env(&"x".repeat(201)).is_err());
        assert!(s.write_env("e", "").is_err());
    }

    fn put(s: &SecretStore<Fake>, a: &str, v: &str) {
        s.backend.map.lock().unwrap().insert(a.into(), v.into());
    }

    #[test]
    fn colliding_ids_stay_separate() {
        let s = store();
        let x = "x".repeat(3000);
        s.write_env("X", &x).unwrap();
        s.write_env("X:0", r#"{"a":"1"}"#).unwrap();
        s.write_env("a:b", "{}").unwrap();
        s.write_env("a", &"y".repeat(2000)).unwrap();
        assert_eq!(s.read_env("X").unwrap().unwrap(), x);
        assert_eq!(s.read_env("X:0").unwrap().as_deref(), Some(r#"{"a":"1"}"#));
        assert_eq!(s.read_env("a:b").unwrap().as_deref(), Some("{}"));
        assert_eq!(s.read_env("a").unwrap().unwrap().len(), 2000);
        s.delete_env("X:0").unwrap();
        assert_eq!(s.read_env("X").unwrap().unwrap(), x);
        assert_eq!(s.read_env("X:0").unwrap(), None);
    }

    #[test]
    fn account_scheme() {
        assert_eq!(header_account("abc_-9", false), "secrets:env:abc_-9");
        assert_eq!(header_account("X:0", false), "secrets:env2:X%3A0");
        assert_eq!(header_account("a%b", false), "secrets:env2:a%25b");
        assert_eq!(chunk_account("é", 3, false), "secrets:env2:%C3%A9:3");
        assert!(header_account(&"é".repeat(100), false).len() < 700);
    }

    #[test]
    fn legacy_unsafe_id_is_read_then_migrated() {
        let s = store();
        put(&s, "secrets:env:a:b", "2");
        put(&s, "secrets:env:a:b:0", "{\"k\":");
        put(&s, "secrets:env:a:b:1", "\"v\"}");
        assert_eq!(s.read_env("a:b").unwrap().as_deref(), Some("{\"k\":\"v\"}"));
        s.write_env("a:b", "{}").unwrap();
        assert_eq!(s.read_env("a:b").unwrap().as_deref(), Some("{}"));
        assert_eq!(keys(&s), vec!["secrets:env2:a%3Ab", "secrets:env2:a%3Ab:0", "secrets:index"]);
    }

    #[test]
    fn legacy_fallback_ignores_other_envs_chunk() {
        let s = store();
        s.write_env("X", r#"{"a":"1"}"#).unwrap();
        // The legacy account of "X:0" is X's chunk 0, which is JSON and not a count.
        assert_eq!(s.read_env("X:0").unwrap(), None);
        s.write_env("X:0", "{}").unwrap();
        s.delete_env("X:0").unwrap();
        assert_eq!(s.read_env("X").unwrap().as_deref(), Some(r#"{"a":"1"}"#));
    }

    #[test]
    fn legacy_safe_id_without_checksum_reads() {
        let s = store();
        put(&s, "secrets:env:e", "1");
        put(&s, "secrets:env:e:0", "{}");
        assert_eq!(s.read_env("e").unwrap().as_deref(), Some("{}"));
    }

    #[test]
    fn mixed_chunks_are_rejected() {
        let s = store();
        s.write_env("e", &"a".repeat(3000)).unwrap();
        put(&s, "secrets:env:e:0", &"b".repeat(1200));
        assert!(s.read_env("e").unwrap_err().0.contains("do not match"));
        put(&s, "secrets:env:e:0", &"a".repeat(1200));
        assert!(s.read_env("e").is_ok());
        put(&s, "secrets:env:e", "garbage");
        assert!(s.read_env("e").unwrap_err().0.contains("bad header"));
    }

    #[test]
    fn corrupt_index_is_recoverable() {
        let s = store();
        s.write_env("a", "{}").unwrap();
        put(&s, "secrets:index", "{not json");
        s.available().unwrap();
        assert_eq!(s.read_env("a").unwrap().as_deref(), Some("{}"));
        assert!(s.list_envs().unwrap_err().0.contains("damaged"));
        s.delete_env("zzz").unwrap();
        s.write_env("b", "{}").unwrap();
        assert_eq!(s.list_envs().unwrap(), vec!["b"]);
        s.backend.map.lock().unwrap().remove("secrets:index");
        assert_eq!(s.read_env("b").unwrap().as_deref(), Some("{}"));
        assert!(s.list_envs().unwrap().is_empty());
    }
}
