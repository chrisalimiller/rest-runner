import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  expiryState,
  findDuplicatePatterns,
  formatFingerprint,
  loadCertificates,
  matchCertificate,
  patternError,
  saveCertificates,
  subscribeCertificates,
  type CertDetails,
  type CertificateEntry,
} from "../lib/certificates";
import { fingerprintOf } from "../lib/certificatesFile";
import { deleteCertificateFiles, importCertificate, setCertificatePassphrase } from "../lib/certificatesNative";
import { isTauri } from "../lib/http";
import { newId } from "../lib/ids";
import { Modal } from "./shell/Modal";
import { useToast } from "./shell/Toast";
import "./certificates.css";

interface Props {
  /** Open on this entry. */
  entryId: string | null;
  onClose: () => void;
}

const ADDING = "__add__";

export function useCertificates(): CertificateEntry[] {
  return useSyncExternalStore(subscribeCertificates, loadCertificates);
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Expiry badge for a certificate: amber within 30 days, red once expired. */
export function ExpiryBadge({ notAfter }: { notAfter: number }) {
  const state = expiryState(notAfter);
  if (state === "ok") return null;
  return <span className={`cert-badge ${state}`}>{state === "expired" ? "Expired" : "Expires soon"}</span>;
}

/** Certificates are kept by the desktop app, so every file operation is disabled in a plain browser. */
export function CertificatesDialog({ entryId, onClose }: Props) {
  const entries = useCertificates();
  const [selectedId, setSelectedId] = useState<string | null>(() => entryId ?? loadCertificates()[0]?.id ?? ADDING);
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const duplicates = useMemo(() => findDuplicatePatterns(entries), [entries]);
  const desktop = isTauri();

  useEffect(() => {
    if (selectedId !== ADDING && !selected) setSelectedId(entries[0]?.id ?? ADDING);
  }, [selectedId, selected, entries]);

  return (
    <Modal label="Certificates" onClose={onClose} className="certs-modal">
      <div className="modal-head">
        <h3>Certificates</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {!desktop && <p className="cert-note warn">Certificates only apply in the desktop app. Importing is turned off here.</p>}
      <div className="env-layout">
        <div className="env-list">
          {entries.map((e) => (
            <button key={e.id} className={e.id === selectedId ? "active" : ""} onClick={() => setSelectedId(e.id)}>
              <span className={e.enabled ? "" : "muted"}>{e.name || "(unnamed)"}</span>
              {e.needsFile && <span className="cert-badge soon">Needs file</span>}
              {e.client && <ExpiryBadge notAfter={e.client.details.notAfter} />}
            </button>
          ))}
          <button className={`link-btn ${selectedId === ADDING ? "active" : ""}`} onClick={() => setSelectedId(ADDING)} disabled={!desktop}>
            + Add certificate
          </button>
        </div>
        <div className="env-edit">
          {selectedId === ADDING ? (
            <ImportForm
              onImported={(entry) => {
                // Importing the same certificate an exported entry was waiting for completes that entry.
                const fp = fingerprintOf(entry);
                const waiting = loadCertificates().find((e) => e.needsFile && fp !== null && fingerprintOf(e) === fp);
                const finished = waiting ? { ...waiting, id: entry.id, client: entry.client, ca: entry.ca, enabled: true, needsFile: undefined } : entry;
                saveCertificates(waiting ? loadCertificates().map((e) => (e === waiting ? finished : e)) : [...loadCertificates(), entry]);
                setSelectedId(finished.id);
              }}
              disabled={!desktop}
              firstOne={entries.length === 0}
              hasWaiting={entries.some((e) => e.needsFile)}
            />
          ) : selected ? (
            <EntryEditor key={selected.id} entry={selected} duplicates={duplicates[selected.id]} entries={entries} desktop={desktop} />
          ) : null}
          <UrlTester entries={entries} />
        </div>
      </div>
    </Modal>
  );
}

function ImportForm({ onImported, disabled, firstOne, hasWaiting }: { onImported: (entry: CertificateEntry) => void; disabled: boolean; firstOne: boolean; hasWaiting: boolean }) {
  const [name, setName] = useState("");
  const [certPath, setCertPath] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [caPath, setCaPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [patterns, setPatterns] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPfx = /\.(p12|pfx)$/i.test(certPath);
  const lines = patterns.split("\n").map((l) => l.trim()).filter(Boolean);
  const patternProblems = lines.map(patternError).filter((p): p is string => p !== null);

  const browse = async (what: "cert" | "key" | "ca") => {
    const filters =
      what === "cert"
        ? [{ name: "Certificates", extensions: ["pem", "crt", "cer", "pfx", "p12"] }]
        : what === "key"
          ? [{ name: "Private keys", extensions: ["key", "pem"] }]
          : [{ name: "CA certificates", extensions: ["pem", "crt", "cer"] }];
    const picked = await open({ multiple: false, directory: false, filters });
    if (typeof picked !== "string") return;
    if (what === "cert") {
      setCertPath(picked);
      if (!name.trim()) setName(picked.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "");
    } else if (what === "key") setKeyPath(picked);
    else setCaPath(picked);
  };

  const canImport = !disabled && !busy && (certPath || caPath) && (lines.length > 0 || hasWaiting) && patternProblems.length === 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const id = newId();
    try {
      const imported = await importCertificate({
        id,
        certPath: certPath || undefined,
        keyPath: !isPfx && keyPath ? keyPath : undefined,
        caPath: caPath || undefined,
        passphrase: passphrase || undefined,
      });
      onImported({
        id,
        name: name.trim() || (imported.client?.details.subject ?? imported.ca?.details.subject ?? "Certificate"),
        enabled: true,
        patterns: lines,
        client: imported.client,
        ca: imported.ca,
      });
    } catch (e) {
      setError(typeof e === "string" ? e : e instanceof Error ? e.message : "Could not import the certificate.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="cert-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canImport) void submit();
      }}
    >
      <h4>Add a certificate</h4>
      {firstOne && (
        <p className="muted small">
          A certificate is sent automatically with every request, test and flow step whose HTTPS address matches one of its patterns. Files are copied into the app, so moving the originals later does not break anything.
        </p>
      )}
      <label className="cert-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme staging mTLS" />
      </label>
      <FileField label="Client certificate" hint=".pem .crt .cer .pfx .p12" value={certPath} onBrowse={() => browse("cert")} onClear={() => setCertPath("")} disabled={disabled} />
      {certPath && !isPfx && <FileField label="Private key" hint="only if it is not inside the certificate file" value={keyPath} onBrowse={() => browse("key")} onClear={() => setKeyPath("")} disabled={disabled} />}
      {certPath && (
        <label className="cert-field">
          <span>Passphrase</span>
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={isPfx ? ".pfx/.p12 passphrase" : "only if the key is encrypted"} autoComplete="off" />
          <small className="muted">Kept in your system keychain, not in the app's files.</small>
        </label>
      )}
      <FileField label="CA certificate (optional)" hint="trust a private or self-signed server" value={caPath} onBrowse={() => browse("ca")} onClear={() => setCaPath("")} disabled={disabled} />
      <label className="cert-field">
        <span>Use for these addresses (one per line){hasWaiting ? ". Can stay empty when finishing an entry that needs its file." : ""}</span>
        <textarea value={patterns} onChange={(e) => setPatterns(e.target.value)} rows={3} spellCheck={false} placeholder={"api.acme.com\n*.staging.acme.com\napi.acme.com:8443/v2"} />
        {patternProblems.length > 0 && <small className="cert-error">{patternProblems[0]}</small>}
      </label>
      {error && <p className="cert-error">{error}</p>}
      <div className="cert-actions">
        <button type="submit" className="primary" disabled={!canImport}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </form>
  );
}

function FileField({ label, hint, value, onBrowse, onClear, disabled }: { label: string; hint: string; value: string; onBrowse: () => void; onClear: () => void; disabled: boolean }) {
  return (
    <div className="cert-field">
      <span>{label}</span>
      <div className="cert-file">
        <input readOnly value={value} placeholder={hint} aria-label={label} title={value} />
        <button type="button" className="secondary" onClick={onBrowse} disabled={disabled}>
          Choose…
        </button>
        {value && (
          <button type="button" className="secondary" onClick={onClear} aria-label={`Clear ${label}`}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function Details({ title, details }: { title: string; details: CertDetails }) {
  return (
    <dl className="cert-details">
      <dt>{title}</dt>
      <dd>{details.subject}</dd>
      <dt>Issuer</dt>
      <dd>{details.issuer}</dd>
      <dt>Valid</dt>
      <dd>
        {formatDate(details.notBefore)} to {formatDate(details.notAfter)} <ExpiryBadge notAfter={details.notAfter} />
      </dd>
      <dt>SHA-256</dt>
      <dd className="mono cert-fingerprint">{formatFingerprint(details.sha256)}</dd>
    </dl>
  );
}

function EntryEditor({ entry, duplicates, entries, desktop }: { entry: CertificateEntry; duplicates?: string[]; entries: CertificateEntry[]; desktop: boolean }) {
  const toast = useToast();
  const [patternText, setPatternText] = useState(entry.patterns.join("\n"));
  const [passphrase, setPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = (patch: Partial<CertificateEntry>) => saveCertificates(entries.map((e) => (e.id === entry.id ? { ...e, ...patch } : e)));
  const lines = patternText.split("\n").map((l) => l.trim()).filter(Boolean);
  const problems = lines.map((l) => [l, patternError(l)] as const).filter(([, p]) => p !== null);

  const remove = async () => {
    try {
      await deleteCertificateFiles(entry.id);
    } catch {
      // The entry goes either way; leftover files are only wasted space.
    }
    saveCertificates(entries.filter((e) => e.id !== entry.id));
    toast.show({ message: `Deleted certificate "${entry.name || "(unnamed)"}"` });
  };

  const changePassphrase = async () => {
    try {
      await setCertificatePassphrase(entry.id, passphrase);
      setPassphrase("");
      setPassphraseError(null);
      toast.show({ message: "Passphrase updated" });
    } catch (e) {
      setPassphraseError(typeof e === "string" ? e : "Could not use that passphrase.");
    }
  };

  return (
    <div className="cert-entry">
      <div className="env-edit-head">
        <input value={entry.name} onChange={(e) => update({ name: e.target.value })} aria-label="Certificate name" />
        <label className="cert-enabled">
          <input type="checkbox" checked={entry.enabled} disabled={entry.needsFile} onChange={(e) => update({ enabled: e.target.checked })} /> Enabled
        </label>
        {confirmDelete ? (
          <button className="secondary danger" onClick={() => void remove()}>
            Delete for good
          </button>
        ) : (
          <button className="secondary danger" onClick={() => setConfirmDelete(true)} onBlur={() => setConfirmDelete(false)}>
            Delete
          </button>
        )}
      </div>

      {entry.needsFile && (
        <p className="cert-note warn">
          This entry came from a workspace file without the certificate files, so it is switched off. Use <strong>+ Add certificate</strong> to import the same certificate: this entry is filled in and switched on by its fingerprint.
        </p>
      )}
      <label className="cert-field">
        <span>Use for these addresses (one per line)</span>
        <textarea
          value={patternText}
          rows={3}
          spellCheck={false}
          onChange={(e) => {
            setPatternText(e.target.value);
            const next = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
            if (next.every((l) => patternError(l) === null)) update({ patterns: next });
          }}
        />
        {problems.map(([line, message]) => (
          <small key={line} className="cert-error">
            {line}: {message}
          </small>
        ))}
        {lines.length === 0 && <small className="cert-error">Add at least one address, or this certificate is never used.</small>}
        {duplicates && duplicates.length > 0 && (
          <small className="cert-warn">Also used by {duplicates.join(", ")} for the same address. The one higher in the list wins.</small>
        )}
      </label>

      {entry.client && (
        <>
          <Details title={`Client certificate (${entry.client.format === "pkcs12" ? ".pfx/.p12" : "PEM"})`} details={entry.client.details} />
          {entry.client.keyUnencrypted && <p className="cert-note warn">This private key has no passphrase. It is stored in the app's data folder, readable by your user account only.</p>}
          {entry.client.hasPassphrase && desktop && (
            <div className="cert-field">
              <span>Change passphrase</span>
              <div className="cert-file">
                <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="New passphrase" autoComplete="off" />
                <button className="secondary" onClick={() => void changePassphrase()} disabled={!passphrase}>
                  Save
                </button>
              </div>
              {passphraseError && <small className="cert-error">{passphraseError}</small>}
            </div>
          )}
        </>
      )}
      {entry.ca && (
        <>
          <Details title={`CA certificate${entry.ca.count > 1 ? ` (1 of ${entry.ca.count})` : ""}`} details={entry.ca.details} />
          <label className="cert-enabled">
            <input type="checkbox" checked={!!entry.caOnly} onChange={(e) => update({ caOnly: e.target.checked })} /> Trust only this CA for these addresses (ignore the system's trusted roots)
          </label>
        </>
      )}
    </div>
  );
}

/** Type a URL and see which certificate would be used, and why. */
function UrlTester({ entries }: { entries: CertificateEntry[] }) {
  const [url, setUrl] = useState("");
  const match = url.trim() ? matchCertificate(url.trim(), entries) : null;
  let result: React.ReactNode = null;
  if (match) {
    if (match.client) {
      result = (
        <>
          Uses <strong>{match.client.name || "(unnamed)"}</strong> (matched <code>{match.clientPattern}</code>)
          {match.ties.length > 0 && <span className="cert-warn"> · also matches {match.ties.map((t) => t.name).join(", ")}; the first in the list wins</span>}
        </>
      );
    } else if (match.insecure) result = "Matches, but this is an http address. Certificates are only used for https.";
    else if (match.cas.length > 0) result = `No client certificate. Trusts ${match.cas.length === 1 ? "the CA" : "the CAs"} of ${match.cas.map((c) => c.name).join(", ")}.`;
    else result = url.includes("{{") ? "Fill in the {{placeholders}} first: matching uses the final address." : "No certificate matches this address.";
  }
  return (
    <div className="cert-tester">
      <label className="cert-field">
        <span>Test an address</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.acme.com/v2/users" spellCheck={false} />
      </label>
      {result && <p className="small cert-result">{result}</p>}
    </div>
  );
}
