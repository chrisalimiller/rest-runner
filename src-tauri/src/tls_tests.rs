//! End to end: a local HTTPS server that demands a client certificate, and real imports and sends.

use std::{collections::HashMap, fs, path::Path, sync::{Arc, Mutex}};

use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair, SanType,
};
use rustls::{pki_types::CertificateDer, server::WebPkiClientVerifier, RootCertStore, ServerConfig};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};
use tokio_rustls::TlsAcceptor;

use crate::{
    certs::{CertStore, ImportRequest, PassphraseStore},
    http::{HttpRequest, HttpState, TlsSpec},
};

#[derive(Default)]
struct MapStore(Mutex<HashMap<String, String>>);

impl PassphraseStore for MapStore {
    fn get(&self, id: &str) -> Option<String> {
        self.0.lock().unwrap().get(id).cloned()
    }
    fn set(&self, id: &str, passphrase: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(id.into(), passphrase.into());
        Ok(())
    }
    fn delete(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}

struct Pki {
    ca_pem: String,
    server_cert: CertificateDer<'static>,
    server_key: Vec<u8>,
    client_der: Vec<u8>,
    client_pem: String,
    client_key_der: Vec<u8>,
    client_key_pem: String,
    other_key_pem: String,
}

fn make_pki() -> Pki {
    let ca_key = KeyPair::generate().unwrap();
    let mut ca_params = CertificateParams::new(vec![]).unwrap();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params.distinguished_name.push(DnType::CommonName, "Test CA");
    let ca = ca_params.self_signed(&ca_key).unwrap();

    let server_key = KeyPair::generate().unwrap();
    let mut server_params = CertificateParams::new(vec![]).unwrap();
    server_params.subject_alt_names = vec![SanType::IpAddress("127.0.0.1".parse().unwrap())];
    let server = server_params.signed_by(&server_key, &ca, &ca_key).unwrap();

    let client_key = KeyPair::generate().unwrap();
    let mut client_params = CertificateParams::new(vec![]).unwrap();
    client_params.distinguished_name.push(DnType::CommonName, "Test Client");
    client_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
    let client = client_params.signed_by(&client_key, &ca, &ca_key).unwrap();

    Pki {
        ca_pem: ca.pem(),
        server_cert: server.der().clone(),
        server_key: server_key.serialize_der(),
        client_der: client.der().to_vec(),
        client_pem: client.pem(),
        client_key_der: client_key.serialize_der(),
        client_key_pem: client_key.serialize_pem(),
        other_key_pem: KeyPair::generate().unwrap().serialize_pem(),
    }
}

/// Answers 200 "secure" to clients holding a certificate signed by the test CA.
async fn serve(pki: &Pki) -> String {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut roots = RootCertStore::empty();
    let ca_der = rustls_pemfile::certs(&mut pki.ca_pem.as_bytes()).next().unwrap().unwrap();
    roots.add(ca_der).unwrap();
    let verifier = WebPkiClientVerifier::builder_with_provider(Arc::new(roots), provider.clone()).build().unwrap();
    let key = rustls::pki_types::PrivateKeyDer::Pkcs8(pki.server_key.clone().into());
    let config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_client_cert_verifier(verifier)
        .with_single_cert(vec![pki.server_cert.clone()], key)
        .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(socket).await else { return };
                let mut buf = vec![0u8; 4096];
                let _ = tls.read(&mut buf).await;
                let _ = tls
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecure")
                    .await;
                let _ = tls.shutdown().await;
            });
        }
    });
    format!("https://127.0.0.1:{port}/")
}

fn encrypted_pem(der: &[u8], passphrase: &str) -> String {
    use pkcs8::{pkcs5::pbes2::Parameters, PrivateKeyInfo};
    let params = Parameters::pbkdf2_sha256_aes256cbc(2048, &[7u8; 16], &[9u8; 16]).unwrap();
    let doc = PrivateKeyInfo::try_from(der).unwrap().encrypt_with_params(params, passphrase).unwrap();
    doc.to_pem("ENCRYPTED PRIVATE KEY", pkcs8::LineEnding::LF).unwrap().to_string()
}

fn p12(pki: &Pki, passphrase: &str) -> Vec<u8> {
    use p12_keystore::{Certificate, KeyStore, KeyStoreEntry, PrivateKeyChain};
    let mut store = KeyStore::new();
    let chain = PrivateKeyChain::new(
        pki.client_key_der.clone(),
        [1u8; 20],
        [Certificate::from_der(&pki.client_der).unwrap()],
    );
    store.add_entry("client", KeyStoreEntry::PrivateKeyChain(chain));
    store.writer(passphrase).write().unwrap()
}

struct Fixture {
    pki: Pki,
    url: String,
    store: Arc<CertStore>,
    http: Arc<HttpState>,
    files: tempfile::TempDir,
    _data: tempfile::TempDir,
}

impl Fixture {
    async fn new() -> Self {
        let pki = make_pki();
        let url = serve(&pki).await;
        let data = tempfile::tempdir().unwrap();
        let store = Arc::new(CertStore::new(data.path().join("certificates"), Arc::new(MapStore::default())));
        let http = Arc::new(HttpState::new(store.clone()));
        let fixture = Fixture { pki, url, store, http, files: tempfile::tempdir().unwrap(), _data: data };
        let ca = fixture.write("server-ca.pem", fixture.pki.ca_pem.as_bytes());
        fixture.store.import(&ImportRequest { id: "serverca".into(), ca_path: Some(ca), ..Default::default() }).unwrap();
        fixture
    }

    fn write(&self, name: &str, bytes: &[u8]) -> String {
        let path = self.files.path().join(name);
        fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn import(&self, id: &str, cert: &str, key: Option<&str>, passphrase: Option<&str>) -> Result<crate::certs::Imported, String> {
        self.store.import(&ImportRequest {
            id: id.into(),
            cert_path: Some(cert.into()),
            key_path: key.map(Into::into),
            passphrase: passphrase.map(Into::into),
            ..Default::default()
        })
    }

    async fn get(&self, cert: Option<&str>, trust_ca: bool) -> Result<String, String> {
        let req = HttpRequest {
            id: "r".into(),
            method: "GET".into(),
            url: self.url.clone(),
            headers: vec![],
            body: None,
            timeout_ms: Some(5000),
            tls: TlsSpec {
                cert_id: cert.map(Into::into),
                ca_ids: if trust_ca { vec!["serverca".into()] } else { vec![] },
                ca_only: false,
            },
        };
        self.http.send(req).await.map(|r| r.body)
    }
}

#[tokio::test]
async fn pem_certificate_with_a_separate_key_authenticates() {
    let f = Fixture::new().await;
    let cert = f.write("client.crt", f.pki.client_pem.as_bytes());
    let key = f.write("client.key", f.pki.client_key_pem.as_bytes());
    let imported = f.import("c1", &cert, Some(&key), None).unwrap();
    let client = imported.client.unwrap();
    assert_eq!(client.format, "pem");
    assert!(client.key_unencrypted && client.separate_key && !client.has_passphrase);
    assert!(client.details.subject.contains("Test Client"), "{:?}", client.details);
    assert_eq!(client.details.sha256.len(), 64);
    assert_eq!(f.get(Some("c1"), true).await.unwrap(), "secure");
}

#[tokio::test]
async fn certificate_and_key_in_one_pem_file() {
    let f = Fixture::new().await;
    let both = format!("{}{}", f.pki.client_pem, f.pki.client_key_pem);
    let cert = f.write("both.pem", both.as_bytes());
    f.import("c1", &cert, None, None).unwrap();
    assert_eq!(f.get(Some("c1"), true).await.unwrap(), "secure");
}

#[tokio::test]
async fn encrypted_pem_key_needs_its_passphrase() {
    let f = Fixture::new().await;
    let cert = f.write("client.crt", f.pki.client_pem.as_bytes());
    let key = f.write("client.key", encrypted_pem(&f.pki.client_key_der, "s3cret").as_bytes());
    assert!(f.import("c1", &cert, Some(&key), None).unwrap_err().contains("encrypted"));
    assert!(f.import("c1", &cert, Some(&key), Some("nope")).unwrap_err().contains("passphrase"));
    assert!(!f.store.identity_pem("c1").is_ok(), "a failed import keeps nothing");
    let client = f.import("c1", &cert, Some(&key), Some("s3cret")).unwrap().client.unwrap();
    assert!(client.has_passphrase && !client.key_unencrypted);
    assert_eq!(f.get(Some("c1"), true).await.unwrap(), "secure");
}

#[tokio::test]
async fn pfx_authenticates_and_a_wrong_passphrase_is_refused() {
    let f = Fixture::new().await;
    let pfx = f.write("client.pfx", &p12(&f.pki, "pfx-pass"));
    let err = f.import("c1", &pfx, None, Some("wrong")).unwrap_err();
    assert!(err.contains("passphrase may be wrong"), "{err}");
    let client = f.import("c1", &pfx, None, Some("pfx-pass")).unwrap().client.unwrap();
    assert_eq!(client.format, "pkcs12");
    assert!(client.has_passphrase);
    assert_eq!(f.get(Some("c1"), true).await.unwrap(), "secure");
}

#[tokio::test]
async fn a_key_that_does_not_match_is_refused() {
    let f = Fixture::new().await;
    let cert = f.write("client.crt", f.pki.client_pem.as_bytes());
    let key = f.write("other.key", f.pki.other_key_pem.as_bytes());
    let err = f.import("c1", &cert, Some(&key), None).unwrap_err();
    assert!(err.contains("does not match"), "{err}");
}

#[tokio::test]
async fn a_certificate_without_a_key_asks_for_one() {
    let f = Fixture::new().await;
    let cert = f.write("client.crt", f.pki.client_pem.as_bytes());
    assert!(f.import("c1", &cert, None, None).unwrap_err().contains("No private key"));
}

#[tokio::test]
async fn without_a_client_certificate_the_server_refuses() {
    let f = Fixture::new().await;
    assert!(f.get(None, true).await.is_err());
}

#[tokio::test]
async fn an_unknown_server_ca_is_not_trusted_unless_imported() {
    let f = Fixture::new().await;
    let cert = f.write("client.crt", f.pki.client_pem.as_bytes());
    let key = f.write("client.key", f.pki.client_key_pem.as_bytes());
    f.import("c1", &cert, Some(&key), None).unwrap();
    let err = f.get(Some("c1"), false).await.unwrap_err();
    assert!(err.to_lowercase().contains("unknownissuer") || err.to_lowercase().contains("certificate"), "{err}");
    assert_eq!(f.get(Some("c1"), true).await.unwrap(), "secure");
}

#[tokio::test]
async fn deleting_removes_the_files_and_the_passphrase() {
    let f = Fixture::new().await;
    let pfx = f.write("client.pfx", &p12(&f.pki, "pfx-pass"));
    f.import("c1", &pfx, None, Some("pfx-pass")).unwrap();
    assert!(Path::new(&f._data.path().join("certificates/c1")).exists());
    f.store.delete("c1");
    assert!(!f._data.path().join("certificates/c1").exists());
    assert!(f.store.identity_pem("c1").is_err());
}

#[tokio::test]
async fn ids_cannot_leave_the_certificates_folder() {
    let f = Fixture::new().await;
    let cert = f.write("client.crt", f.pki.client_pem.as_bytes());
    assert!(f.import("../evil", &cert, None, None).unwrap_err().contains("Invalid certificate id"));
}
