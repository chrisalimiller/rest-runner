import { matchCertificate } from "../../lib/certificates";
import { openCertificates } from "../../lib/certificatesDialog";
import { isTauri } from "../../lib/http";
import { useCertificates } from "../CertificatesDialog";
import { LockIcon } from "../shell/Icons";

interface Props {
  /** The final URL, with variables and query params filled in. */
  url: string;
  /** This request is set to leave out the client certificate. */
  skipped: boolean;
  onSkip: (skip: boolean) => void;
}

/**
 * Shows which imported certificate Send will use for the resolved URL, and lets the request leave
 * the client certificate out. Test cases and flow steps use the same editor, so they get it too.
 */
export function CertificateChip({ url, skipped, onSkip }: Props) {
  const entries = useCertificates();
  if (!isTauri() || entries.length === 0 || !url) return null;
  const match = matchCertificate(url, entries);

  if (match.insecure) {
    return (
      <span className="cert-chip warn" title="A certificate matches this address, but certificates are only used for https.">
        <LockIcon size={11} /> Certificate not used: http
      </span>
    );
  }
  if (match.client) {
    const name = match.client.name || "(unnamed)";
    return (
      <>
        <button
          className={`cert-chip ${skipped ? "off" : ""}`}
          onClick={() => openCertificates(match.client!.id)}
          title={`${skipped ? "Left out for this request" : "Sent with this request"}: ${name} (matched ${match.clientPattern}). Click to open it.`}
        >
          <LockIcon size={11} /> {skipped ? `Cert off: ${name}` : `Cert: ${name}`}
        </button>
        <button className="link-btn small" onClick={() => onSkip(!skipped)} title="Applies to this request only. A matching CA is still trusted.">
          {skipped ? "Use certificate" : "Send without"}
        </button>
      </>
    );
  }
  if (match.cas.length > 0) {
    return (
      <button className="cert-chip" onClick={() => openCertificates(match.cas[0].id)} title={`Trusts the CA of ${match.cas.map((c) => c.name).join(", ")} for this address.`}>
        <LockIcon size={11} /> CA: {match.cas[0].name}
      </button>
    );
  }
  return null;
}
