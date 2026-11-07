import type { CertificateEntry } from "./certificates";
import { deleteCertificateFiles, exportCertificateFiles, importCertificate, type ExportedCertificateFiles } from "./certificatesNative";
import { newId } from "./ids";

/** A certificate entry as written to a workspace file. `files` is there only when the export included them. */
export interface ExportedCertificate extends Omit<CertificateEntry, "needsFile"> {
  files?: ExportedCertificateFiles;
}

/** What identifies a certificate across computers: the fingerprint of its client certificate, or of its CA. */
export function fingerprintOf(entry: Pick<CertificateEntry, "client" | "ca">): string | null {
  return entry.client?.details.sha256 ?? entry.ca?.details.sha256 ?? null;
}

/**
 * The entries for a workspace file. Without `includeFiles` there are no keys or passphrases in it, only
 * names, patterns and fingerprints. Entries that never had files (`needsFile`) are left out.
 */
export async function certificatesForExport(entries: readonly CertificateEntry[], includeFiles: boolean): Promise<ExportedCertificate[]> {
  const out: ExportedCertificate[] = [];
  for (const { needsFile, ...entry } of entries) {
    if (needsFile) continue;
    out.push(includeFiles ? { ...entry, files: await exportCertificateFiles(entry.id) } : entry);
  }
  return out;
}

function isExported(x: unknown): x is ExportedCertificate {
  const e = x as ExportedCertificate;
  return !!e && typeof e.id === "string" && typeof e.name === "string" && Array.isArray(e.patterns) && (!!e.client || !!e.ca);
}

export interface CertificateImport {
  entries: CertificateEntry[];
  added: number;
  updated: number;
  /** Entries that arrived without their files and wait for them. */
  needFiles: string[];
  warnings: string[];
}

/**
 * Merges the certificates of a workspace file into the current list. An entry with the same
 * fingerprint is updated (name, patterns, enabled), not duplicated. New ones arrive with their files
 * when the file has them; otherwise they are disabled and marked "needs file" until the same
 * certificate is imported by hand.
 */
export async function importCertificates(
  data: unknown,
  current: readonly CertificateEntry[],
  importFiles: typeof importCertificate = importCertificate,
  deleteFiles: typeof deleteCertificateFiles = deleteCertificateFiles,
): Promise<CertificateImport> {
  const incoming = (Array.isArray(data) ? data : []).filter(isExported);
  const entries = [...current];
  const result: CertificateImport = { entries, added: 0, updated: 0, needFiles: [], warnings: [] };
  for (const { files, ...meta } of incoming) {
    const fp = fingerprintOf(meta);
    const at = fp ? entries.findIndex((e) => fingerprintOf(e) === fp) : -1;
    if (at !== -1) {
      result.updated += 1;
      result.warnings.push(`Local rules for "${entries[at].name}" were kept. Review and edit them under Certificates if needed.`);
      continue;
    }
    const id = newId();
    if (files) {
      try {
        const allowed = ["certData", "certName", "keyData", "caData", "passphrase"];
        if (typeof files !== "object" || Array.isArray(files) || Object.entries(files).some(([key, value]) => !allowed.includes(key) || (value !== undefined && typeof value !== "string"))) {
          throw new Error("Invalid certificate file fields.");
        }
        if (!files.certData && !files.caData) throw new Error("Certificate file data is missing.");
        const imported = await importFiles({ id, certData: files.certData, certName: files.certName, keyData: files.keyData, caData: files.caData, passphrase: files.passphrase });
        const actual = { ...meta, id, client: imported.client ?? undefined, ca: imported.ca ?? undefined };
        const actualFingerprint = fingerprintOf(actual);
        const duplicate = actualFingerprint && entries.find((entry) => fingerprintOf(entry) === actualFingerprint);
        if (duplicate) {
          await deleteFiles(id);
          result.updated += 1;
          result.warnings.push(`Local rules for "${duplicate.name}" were kept. Review and edit them under Certificates if needed.`);
          continue;
        }
        entries.push(actual);
        result.added += 1;
        continue;
      } catch (e) {
        result.warnings.push(`Could not import the files of "${meta.name}": ${typeof e === "string" ? e : e instanceof Error ? e.message : "unknown error"}`);
      }
    }
    entries.push({ ...meta, id, enabled: false, needsFile: true });
    result.needFiles.push(meta.name);
    result.added += 1;
  }
  return result;
}

/** Notice text for the part of an import that dealt with certificates. */
export function describeCertificateImport(r: CertificateImport): string {
  const parts = [r.added ? `${r.added} added` : "", r.updated ? `${r.updated} matched (local rules kept)` : ""].filter(Boolean).join(", ");
  const waiting = r.needFiles.length ? ` ${r.needFiles.length === 1 ? `"${r.needFiles[0]}" needs its files` : `${r.needFiles.length} certificates need their files`}: import the same certificate under Certificates to finish.` : "";
  return `certificates: ${parts || "nothing new"}.${waiting}${r.warnings.length ? ` ${r.warnings.join(" ")}` : ""}`;
}
