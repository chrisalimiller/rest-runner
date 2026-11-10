import { loadCertificates, saveCertificates } from "./certificates";
import { describeCertificateImport, importCertificates } from "./certificatesFile";
import { canImport, computeImport, type ImportChoice, type ImportOutcome } from "./importFlow";
import { readWorkspace, writeWorkspace } from "./workspaceStore";

export interface CommittedImport {
  outcome: ImportOutcome;
  /** Notice text for imported certificate rules, or null. */
  certificates: string | null;
  /** Puts everything back as it was before the import. Returns false when storage refused. */
  undo: () => boolean;
}

/**
 * Writes an import to storage. The import is worked out on a copy first (`computeImport`); nothing is
 * written until it is complete, and a failed write puts the old data back. The returned `undo` restores
 * the workspace and certificate list exactly as they were.
 */
export async function commitImport(choices: readonly ImportChoice[]): Promise<CommittedImport> {
  const before = readWorkspace();
  const certificatesBefore = loadCertificates();
  const outcome = computeImport(before, choices);
  if (!canImport(choices, outcome)) throw new Error("Resolve every name clash and check something to import.");
  if (!writeWorkspace(outcome.workspace)) {
    writeWorkspace(before);
    throw new Error("local storage is full");
  }
  const undo = () => {
    const ok = writeWorkspace(before);
    saveCertificates(certificatesBefore);
    return ok;
  };
  let certificates: string | null = null;
  try {
    const rules = choices.filter((c) => c.checked && c.item.kind === "certificates").flatMap((c) => c.item.certificates ?? []);
    if (rules.length > 0) {
      const r = await importCertificates(rules, certificatesBefore);
      if (r.added + r.updated > 0) saveCertificates(r.entries);
      certificates = describeCertificateImport(r);
    }
  } catch (e) {
    undo();
    throw e;
  }
  return { outcome, certificates, undo };
}
