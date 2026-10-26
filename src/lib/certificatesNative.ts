import { invoke } from "@tauri-apps/api/core";
import type { CaDetailsInfo, CertDetails } from "./certificates";

/** What `cert_import` answers with (`Imported` in src-tauri/src/certs.rs). */
export interface ImportedCertificate {
  client?: {
    format: "pem" | "pkcs12";
    details: CertDetails;
    separateKey: boolean;
    hasPassphrase: boolean;
    keyUnencrypted: boolean;
  };
  ca?: CaDetailsInfo;
}

export interface ImportFiles {
  id: string;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
  passphrase?: string;
  /** The files as base64 instead of paths, from a workspace export. */
  certData?: string;
  certName?: string;
  keyData?: string;
  caData?: string;
}

/** An entry's files as stored in a workspace export that includes them. */
export interface ExportedCertificateFiles {
  certData?: string;
  /** `client.pem` or `client.p12`. */
  certName?: string;
  keyData?: string;
  caData?: string;
  passphrase?: string;
}

/** Checks the picked files and copies them into the app's data folder. Rejects with a message to show. */
export function importCertificate(files: ImportFiles): Promise<ImportedCertificate> {
  return invoke<ImportedCertificate>("cert_import", { request: files });
}

/** Replaces the passphrase in the system keychain. Rejects when it does not open the certificate. */
export function setCertificatePassphrase(id: string, passphrase: string): Promise<void> {
  return invoke("cert_set_passphrase", { id, passphrase });
}

/** Reads an entry's files and passphrase back, for an export that includes them. */
export function exportCertificateFiles(id: string): Promise<ExportedCertificateFiles> {
  return invoke<ExportedCertificateFiles>("cert_export", { id });
}

/** Removes the files and the keychain item. */
export function deleteCertificateFiles(id: string): Promise<void> {
  return invoke("cert_delete", { id });
}
