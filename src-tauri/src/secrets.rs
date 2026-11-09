//! Secret environment variable values, kept in the OS keychain instead of localStorage.
//!
//! Each environment's values are one JSON string (variable id -> value). Credential stores limit
//! the size of one item (Windows Credential Manager: 2560 bytes, stored as UTF-16 by `keyring`), so
//! the JSON is split into chunks under the accounts `secrets:env:{env_id}:{n}`, with a header item
//! `secrets:env:{env_id}` holding the chunk count. `secrets:index` lists the ids that have secrets.
//! Unlike the certificate passphrases, reads report locked or denied keychains instead of hiding them.

use std::{fmt, sync::Arc, sync::Mutex};

const SERVICE: &str = "rest-runner";
const INDEX_ACCOUNT: &str = "secrets:index";
/// Max UTF-8 bytes per chunk. Windows Credential Manager limits a credential blob to 2560 bytes and the
/// keyring crate stores the value as UTF-16 (2 bytes per unit). A UTF-8 byte never costs more than one UTF-16
/// unit, so 1200 bytes is at most 1200 units = 2400 bytes, under the limit. (1800 would be up to 3600 bytes.)
const CHUNK_BYTES: usize = 1200;
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
pub struct KeyringBackend;

impl KeyringBackend {
    fn entry(account: &str) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(SERVICE, account).map_err(|e| map_err("open the system keychain", e))
    }
}

fn map_err(action: &str, e: keyring::Error) -> SecretError {
    let why = match &e {
        keyring::Error::NoStorageAccess(_) => "the keychain is locked or access was denied".to_string(),
        keyring::Error::TooLong(..) => "the value is too large for the keychain".to_string(),
        other => other.to_string(),
    };
    SecretError(format!("Could not {action}: {why}"))
}

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

/// Chunking, header and index logic over any backend.
pub struct SecretStore<B: SecretBackend> {
    backend: B,
    /// Serializes writes so the index and headers are not updated by two calls at once.
    lock: Mutex<()>,
}

fn header_account(id: &str) -> String {
    format!("secrets:env:{id}")
}

fn chunk_account(id: &str, n: usize) -> String {
    format!("secrets:env:{id}:{n}")
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

    fn chunk_count(&self, id: &str) -> Result<Option<usize>, SecretError> {
        match self.backend.get(&header_account(id))? {
            None => Ok(None),
            Some(h) => h.trim().parse::<usize>().map(Some).map_err(|_| {
                SecretError(format!("The stored secrets for environment {id} are damaged (bad header)."))
            }),
        }
    }

    pub fn read_env(&self, id: &str) -> Result<Option<String>, SecretError> {
        validate_id(id).map_err(SecretError)?;
        let Some(count) = self.chunk_count(id)? else { return Ok(None) };
        let mut out = String::new();
        for n in 0..count {
            match self.backend.get(&chunk_account(id, n))? {
                Some(c) => out.push_str(&c),
                None => {
                    return Err(SecretError(format!(
                        "The stored secrets for environment {id} are damaged (missing part {n} of {count})."
                    )))
                }
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
        let old_count = self.chunk_count(id).ok().flatten().unwrap_or(0);
        // Old chunk texts, so a failed write can put them back and the previous value stays readable.
        let old: Vec<Option<String>> =
            (0..old_count).map(|n| self.backend.get(&chunk_account(id, n)).ok().flatten()).collect();
        let chunks = split_chunks(json, CHUNK_BYTES);
        for (n, chunk) in chunks.iter().enumerate() {
            if let Err(e) = self.backend.set(&chunk_account(id, n), chunk) {
                // Chunks 0..=n may have been overwritten; restore them. The header was not touched.
                for m in 0..=n {
                    let _ = match old.get(m).cloned().flatten() {
                        Some(prev) => self.backend.set(&chunk_account(id, m), &prev),
                        None => self.backend.delete(&chunk_account(id, m)),
                    };
                }
                return Err(SecretError(format!(
                    "Could not save secret values (part {} of {}): {e}",
                    n + 1,
                    chunks.len()
                )));
            }
        }
        self.backend
            .set(&header_account(id), &chunks.len().to_string())
            .map_err(|e| SecretError(format!("Could not save secret values: {e}")))?;
        for n in chunks.len()..old_count {
            self.backend.delete(&chunk_account(id, n))?;
        }
        self.index_update(|ids| {
            if !ids.iter().any(|i| i == id) {
                ids.push(id.to_string());
            }
        })
    }

    pub fn delete_env(&self, id: &str) -> Result<(), SecretError> {
        validate_id(id).map_err(SecretError)?;
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        // Header first: with no header the environment reads as absent even if a chunk delete fails.
        let count = self.chunk_count(id).ok().flatten().unwrap_or(0);
        self.backend.delete(&header_account(id))?;
        for n in 0..count {
            self.backend.delete(&chunk_account(id, n))?;
        }
        self.index_update(|ids| ids.retain(|i| i != id))
    }

    pub fn list_envs(&self) -> Result<Vec<String>, SecretError> {
        self.index_read()
    }

    /// A cheap probe: succeeds when the keychain can be read.
    pub fn available(&self) -> Result<(), SecretError> {
        self.index_read().map(|_| ())
    }

    fn index_read(&self) -> Result<Vec<String>, SecretError> {
        match self.backend.get(INDEX_ACCOUNT)? {
            None => Ok(Vec::new()),
            Some(s) => {
                serde_json::from_str(&s).map_err(|_| SecretError("The stored secrets index is damaged.".into()))
            }
        }
    }

    fn index_update(&self, f: impl FnOnce(&mut Vec<String>)) -> Result<(), SecretError> {
        let mut ids = self.index_read()?;
        let before = ids.clone();
        f(&mut ids);
        if ids == before {
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
        assert_eq!(s.backend.get("secrets:env:a").unwrap().as_deref(), Some("1"));
    }

    #[test]
    fn chunk_boundaries() {
        for len in [1199, 1200, 1201, 2400, 2401] {
            let s = store();
            let v = "a".repeat(len);
            s.write_env("e", &v).unwrap();
            let expect = len.div_ceil(1200);
            assert_eq!(s.backend.get("secrets:env:e").unwrap().unwrap(), expect.to_string());
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
}
