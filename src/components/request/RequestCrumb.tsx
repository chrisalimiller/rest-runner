interface Props {
  /** Collection, then folders, then (for an example) the request it belongs to. Empty when the request is not saved. */
  crumbs: string[];
  name: string;
  /** "Unsaved changes" or "Not saved" when the status should call attention to itself, otherwise null. */
  unsaved: string | null;
  /** Open the collections sidebar at a segment: the index into `crumbs`. */
  onReveal: (index: number) => void;
}

/**
 * Where the open request is saved, as a path above the URL bar: Collection › Folder › Request name.
 * Every segment opens the sidebar at that collection or folder; the status sits at the right end.
 */
export function RequestCrumb({ crumbs, name, unsaved, onReveal }: Props) {
  const title = name || "Untitled request";
  return (
    <nav className="request-crumb" aria-label="Where this request is saved">
      <ol>
        {crumbs.length === 0 ? (
          <li className="crumb-unsaved-where">Not in a collection</li>
        ) : (
          crumbs.map((c, i) => (
            <li key={i}>
              <button className="crumb-seg" onClick={() => onReveal(i)} title={`Show ${c} in the sidebar`}>
                {c}
              </button>
              <span className="crumb-sep" aria-hidden>
                ›
              </span>
            </li>
          ))
        )}
        <li className="crumb-cur" aria-current="page" title={title}>
          {title}
        </li>
      </ol>
      <span className={`crumb-status ${unsaved ? "warn" : ""}`}>{unsaved ?? "Saved"}</span>
    </nav>
  );
}
