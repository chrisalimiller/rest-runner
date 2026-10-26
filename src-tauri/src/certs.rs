//! Client certificates and custom CAs for HTTPS calls.
//!
//! Imported files are copied to `<app data>/certificates/<id>/` as `client.pem` or
//! `client.p12`, `key.pem` (when the key is a separate file) and `ca.pem`. Passphrases live in the
//! OS keychain, never on disk and never in the web view after import.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pkcs8::EncryptedPrivateKeyInfo;
use rustls::{
    crypto::ring::sign::any_supported_type,
    pki_types::{CertificateDer, PrivateKeyDer},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x509_parser::prelude::{FromDer, X509Certificate};

const CLIENT_PEM: &str = "client.pem";
const CLIENT_P12: &str = "client.p12";
const KEY_PEM: &str = "key.pem";
const CA_PEM: &str = "ca.pem";

/// Where passphrases are kept. The OS keychain in the app; a map in tests.
pub trait PassphraseStore: Send + Sync {
    fn get(&self, id: &str) -> Option<String>;
    fn set(&self, id: &str, passphrase: &str) -> Result<(), String>;
    fn delete(&self, id: &str);
}

/// macOS Keychain and Windows Credential Manager, through the `keyring` crate.
pub struct Keychain;

impl Keychain {
    fn entry(id: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new("rest-runner", &format!("cert:{id}"))
            .map_err(|e| format!("Could not open the system keychain: {e}"))
    }
}

impl PassphraseStore for Keychain {
    fn get(&self, id: &str) -> Option<String> {
        Self::entry(id).ok()?.get_password().ok()
    }

    fn set(&self, id: &str, passphrase: &str) -> Result<(), String> {
        Self::entry(id)?
            .set_password(passphrase)
            .map_err(|e| format!("Could not save the passphrase to the system keychain: {e}"))
    }

    fn delete(&self, id: &str) {
        if let Ok(entry) = Self::entry(id) {
            let _ = entry.delete_credential();
        }
    }
}

pub struct CertStore {
    dir: PathBuf,
    passphrases: Arc<dyn PassphraseStore>,
}

/// What the web view sends to import a certificate. All fields are optional, but an entry
/// needs a client certificate or a CA.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub id: String,
    /// `.pem`, `.crt`, `.cer`, `.pfx` or `.p12`.
    pub cert_path: Option<String>,
    /// A separate PEM private key.
    pub key_path: Option<String>,
    pub ca_path: Option<String>,
    pub passphrase: Option<String>,
    /// The same files as base64, from a workspace export, instead of paths. `cert_name` says
    /// whether the certificate is a .pfx/.p12 (by its extension).
    pub cert_data: Option<String>,
    pub cert_name: Option<String>,
    pub key_data: Option<String>,
    pub ca_data: Option<String>,
}

/// An entry's files and passphrase for a workspace export that includes them. Files are base64.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedFiles {
    pub cert_data: Option<String>,
    /// `client.pem` or `client.p12`.
    pub cert_name: Option<String>,
    pub key_data: Option<String>,
    pub ca_data: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub subject: String,
    pub issuer: String,
    /// Unix seconds.
    pub not_before: i64,
    pub not_after: i64,
    /// Fingerprint of the certificate, lowercase hex.
    pub sha256: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub client: Option<ClientDetails>,
    pub ca: Option<CaDetails>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientDetails {
    /// "pem" or "pkcs12".
    pub format: &'static str,
    pub details: Details,
    /// The PEM key is a separate file.
    pub separate_key: bool,
    /// The passphrase was needed (PFX, or an encrypted key) and is now in the keychain.
    pub has_passphrase: bool,
    /// The key sits in a file without a passphrase.
    pub key_unencrypted: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaDetails {
    pub count: usize,
    pub details: Details,
}

struct Material {
    chain: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
    key_encrypted: bool,
}

impl CertStore {
    pub fn new(dir: PathBuf, passphrases: Arc<dyn PassphraseStore>) -> Self {
        Self { dir, passphrases }
    }

    fn folder(&self, id: &str) -> Result<PathBuf, String> {
        // Ids are made by the app, but never let one climb out of the folder.
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(format!("Invalid certificate id: {id}"));
        }
        Ok(self.dir.join(id))
    }

    /// Validates the files, copies them into the app's folder and keeps the passphrase.
    /// Nothing is kept when it fails.
    pub fn import(&self, req: &ImportRequest) -> Result<Imported, String> {
        let folder = self.folder(&req.id)?;
        let passphrase = req.passphrase.as_deref().filter(|p| !p.is_empty());
        let read = |path: &Option<String>, data: &Option<String>, what: &str| -> Result<Option<Vec<u8>>, String> {
            match (path, data) {
                (Some(path), _) => fs::read(path)
                    .map(Some)
                    .map_err(|e| format!("Could not read the {what} file {path}: {e}")),
                (None, Some(data)) => BASE64
                    .decode(data)
                    .map(Some)
                    .map_err(|_| format!("The {what} file in the export is damaged.")),
                (None, None) => Ok(None),
            }
        };

        let cert_bytes = read(&req.cert_path, &req.cert_data, "certificate")?;
        let key_bytes = read(&req.key_path, &req.key_data, "key")?;
        let ca_bytes = read(&req.ca_path, &req.ca_data, "CA")?;
        let cert_name = req.cert_path.as_deref().or(req.cert_name.as_deref()).unwrap_or("");
        if cert_bytes.is_none() && ca_bytes.is_none() {
            return Err("Pick a client certificate, a CA file, or both.".into());
        }
        if key_bytes.is_some() && cert_bytes.is_none() {
            return Err("A key file needs its certificate file too.".into());
        }

        let mut client = None;
        let mut client_file = None;
        if let Some(bytes) = &cert_bytes {
            let is_p12 = is_pkcs12(bytes, cert_name);
            let material = if is_p12 {
                load_pkcs12(bytes, passphrase.unwrap_or(""))?
            } else {
                load_pem(bytes, key_bytes.as_deref(), passphrase)?
            };
            let details = details_of(&material.chain[0])?;
            let key_unencrypted = !is_p12 && !material.key_encrypted;
            client = Some(ClientDetails {
                format: if is_p12 { "pkcs12" } else { "pem" },
                details,
                separate_key: key_bytes.is_some(),
                has_passphrase: is_p12 && passphrase.is_some() || material.key_encrypted,
                key_unencrypted,
            });
            client_file = Some(if is_p12 { CLIENT_P12 } else { CLIENT_PEM });
        }

        let mut ca = None;
        if let Some(bytes) = &ca_bytes {
            let certs = pem_certs(bytes)?;
            if certs.is_empty() {
                return Err("The CA file has no certificates in it (expected PEM).".into());
            }
            ca = Some(CaDetails { count: certs.len(), details: details_of(&certs[0])? });
        }

        // Everything parsed. Now write, starting from a clean folder.
        let _ = fs::remove_dir_all(&folder);
        let write = || -> Result<(), String> {
            fs::create_dir_all(&folder).map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
            let put = |name: &str, bytes: &[u8]| {
                fs::write(folder.join(name), bytes).map_err(|e| format!("Could not save {name}: {e}"))
            };
            if let (Some(name), Some(bytes)) = (client_file, &cert_bytes) {
                put(name, bytes)?;
            }
            if let Some(bytes) = &key_bytes {
                put(KEY_PEM, bytes)?;
            }
            if let Some(bytes) = &ca_bytes {
                put(CA_PEM, bytes)?;
            }
            restrict(&folder);
            Ok(())
        };
        let needs_passphrase = client.as_ref().is_some_and(|c| c.has_passphrase);
        let stored = write().and_then(|()| match (needs_passphrase, passphrase) {
            (true, Some(p)) => self.passphrases.set(&req.id, p),
            _ => Ok(()),
        });
        if let Err(e) = stored {
            self.delete(&req.id);
            return Err(e);
        }
        Ok(Imported { client, ca })
    }

    /// Reads an entry's files back for an export that includes them.
    pub fn export_files(&self, id: &str) -> Result<ExportedFiles, String> {
        let folder = self.folder(id)?;
        let read = |name: &str| fs::read(folder.join(name)).ok().map(|bytes| BASE64.encode(bytes));
        let (cert_name, cert_data) = if let Some(data) = read(CLIENT_P12) {
            (Some(CLIENT_P12.to_string()), Some(data))
        } else {
            (read(CLIENT_PEM).map(|_| CLIENT_PEM.to_string()), read(CLIENT_PEM))
        };
        if cert_data.is_none() && read(CA_PEM).is_none() {
            return Err("The certificate files are missing.".into());
        }
        Ok(ExportedFiles { cert_data, cert_name, key_data: read(KEY_PEM), ca_data: read(CA_PEM), passphrase: self.passphrases.get(id) })
    }

    /// Replaces the stored passphrase after checking it opens the certificate.
    pub fn set_passphrase(&self, id: &str, passphrase: &str) -> Result<(), String> {
        self.identity_with(id, Some(passphrase))?;
        self.passphrases.set(id, passphrase)
    }

    /// Removes the files and the keychain item. Safe to call for an id that does not exist.
    pub fn delete(&self, id: &str) {
        if let Ok(folder) = self.folder(id) {
            let _ = fs::remove_dir_all(folder);
            self.passphrases.delete(id);
        }
    }

    /// The client certificate chain and key as one PEM buffer, for `reqwest::Identity::from_pem`.
    pub fn identity_pem(&self, id: &str) -> Result<Vec<u8>, String> {
        self.identity_with(id, None)
    }

    fn identity_with(&self, id: &str, passphrase: Option<&str>) -> Result<Vec<u8>, String> {
        let folder = self.folder(id)?;
        let kept = self.passphrases.get(id);
        let passphrase = passphrase.or(kept.as_deref()).filter(|p| !p.is_empty());
        let material = if let Ok(bytes) = fs::read(folder.join(CLIENT_P12)) {
            load_pkcs12(&bytes, passphrase.unwrap_or(""))?
        } else {
            let cert = fs::read(folder.join(CLIENT_PEM))
                .map_err(|_| "The certificate files are missing. Import the certificate again.".to_string())?;
            let key = fs::read(folder.join(KEY_PEM)).ok();
            load_pem(&cert, key.as_deref(), passphrase)?
        };
        Ok(to_pem(&material))
    }

    /// The CA bundle of an entry, PEM.
    pub fn ca_pem(&self, id: &str) -> Result<Vec<u8>, String> {
        fs::read(self.folder(id)?.join(CA_PEM))
            .map_err(|_| "The CA file is missing. Import the certificate again.".to_string())
    }
}

/// Keeps the folder to the current user where the platform allows it (mode 700 on macOS and Linux;
/// Windows already limits the app data folder to the user).
fn restrict(folder: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(folder, fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    let _ = folder;
}

fn is_pkcs12(bytes: &[u8], path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".p12") || lower.ends_with(".pfx") || bytes.first() == Some(&0x30) && !text_has(bytes, "-----BEGIN")
}

fn text_has(bytes: &[u8], needle: &str) -> bool {
    String::from_utf8_lossy(bytes).contains(needle)
}

fn pem_certs(bytes: &[u8]) -> Result<Vec<CertificateDer<'static>>, String> {
    rustls_pemfile::certs(&mut &bytes[..])
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not read the PEM certificates: {e}"))
}

fn load_pkcs12(bytes: &[u8], passphrase: &str) -> Result<Material, String> {
    let store = p12_keystore::KeyStore::from_pkcs12(bytes, passphrase)
        .map_err(|_| "Could not open the .pfx/.p12 file. The passphrase may be wrong, or the file is damaged.".to_string())?;
    let (_, chain) = store
        .private_key_chain()
        .ok_or("The .pfx/.p12 file holds no private key.")?;
    let certs: Vec<CertificateDer<'static>> =
        chain.chain().iter().map(|c| CertificateDer::from(c.as_der().to_vec())).collect();
    if certs.is_empty() {
        return Err("The .pfx/.p12 file holds no certificate.".into());
    }
    let key = PrivateKeyDer::Pkcs8(chain.key().to_vec().into());
    finish(certs, key, false)
}

fn load_pem(cert_bytes: &[u8], key_bytes: Option<&[u8]>, passphrase: Option<&str>) -> Result<Material, String> {
    let certs = pem_certs(cert_bytes)?;
    if certs.is_empty() {
        return Err("No certificate found in the file (expected PEM).".into());
    }
    // The key is in its own file, or in the certificate file.
    let mut candidates = vec![];
    if let Some(bytes) = key_bytes {
        candidates.push(bytes);
    }
    candidates.push(cert_bytes);
    for bytes in candidates {
        let text = String::from_utf8_lossy(bytes);
        if text.contains("-----BEGIN ENCRYPTED PRIVATE KEY-----") {
            let pass = passphrase.ok_or("The private key is encrypted. Enter its passphrase.")?;
            let pem = text
                .split("-----BEGIN ENCRYPTED PRIVATE KEY-----")
                .nth(1)
                .and_then(|rest| rest.split("-----END ENCRYPTED PRIVATE KEY-----").next())
                .ok_or("The encrypted private key is damaged.")?;
            let block = format!("-----BEGIN ENCRYPTED PRIVATE KEY-----{pem}-----END ENCRYPTED PRIVATE KEY-----\n");
            let (_, encrypted) = pem_rfc7468::decode_vec(block.as_bytes())
                .map_err(|_| "The encrypted private key could not be read.".to_string())?;
            let info = EncryptedPrivateKeyInfo::try_from(encrypted.as_slice())
                .map_err(|_| "The encrypted private key could not be read.".to_string())?;
            let der = info
                .decrypt(pass)
                .map_err(|_| "Could not decrypt the private key. The passphrase may be wrong.".to_string())?;
            let key = PrivateKeyDer::Pkcs8(der.as_bytes().to_vec().into());
            return finish(certs, key, true);
        }
        if text.contains("Proc-Type: 4,ENCRYPTED") {
            return Err("This key uses the old OpenSSL encryption. Convert it first: openssl pkcs8 -topk8 -in key.pem -out key-pkcs8.pem".into());
        }
        if let Some(key) = rustls_pemfile::private_key(&mut &bytes[..]).map_err(|e| format!("Could not read the private key: {e}"))? {
            return finish(certs, key, false);
        }
    }
    Err("No private key found. Pick the key file too, or use a .pfx/.p12 file.".into())
}

/// Puts the certificate that matches the key first, and fails when none does.
fn finish(mut chain: Vec<CertificateDer<'static>>, key: PrivateKeyDer<'static>, key_encrypted: bool) -> Result<Material, String> {
    let signing = any_supported_type(&key).map_err(|_| "This private key type is not supported (use RSA, ECDSA or Ed25519).".to_string())?;
    if let Some(public) = signing.public_key() {
        let at = chain
            .iter()
            .position(|cert| {
                X509Certificate::from_der(cert.as_ref())
                    .map(|(_, c)| c.tbs_certificate.subject_pki.raw == public.as_ref())
                    .unwrap_or(false)
            })
            .ok_or("The private key does not match the certificate.")?;
        chain.swap(0, at);
    }
    Ok(Material { chain, key, key_encrypted })
}

fn to_pem(material: &Material) -> Vec<u8> {
    use pem_rfc7468::{encode_string, LineEnding};
    let mut out = String::new();
    for cert in &material.chain {
        out.push_str(&encode_string("CERTIFICATE", LineEnding::LF, cert.as_ref()).unwrap_or_default());
    }
    let (label, der): (&str, &[u8]) = match &material.key {
        PrivateKeyDer::Pkcs1(k) => ("RSA PRIVATE KEY", k.secret_pkcs1_der()),
        PrivateKeyDer::Sec1(k) => ("EC PRIVATE KEY", k.secret_sec1_der()),
        PrivateKeyDer::Pkcs8(k) => ("PRIVATE KEY", k.secret_pkcs8_der()),
        _ => ("PRIVATE KEY", &[]),
    };
    out.push_str(&encode_string(label, LineEnding::LF, der).unwrap_or_default());
    out.into_bytes()
}

fn details_of(cert: &CertificateDer<'_>) -> Result<Details, String> {
    let (_, parsed) = X509Certificate::from_der(cert.as_ref())
        .map_err(|_| "Could not read the certificate details.".to_string())?;
    let validity = parsed.validity();
    Ok(Details {
        subject: parsed.subject().to_string(),
        issuer: parsed.issuer().to_string(),
        not_before: validity.not_before.timestamp(),
        not_after: validity.not_after.timestamp(),
        sha256: Sha256::digest(cert.as_ref()).iter().map(|b| format!("{b:02x}")).collect(),
    })
}
