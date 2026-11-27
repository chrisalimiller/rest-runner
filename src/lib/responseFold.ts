/**
 * The request column's tab row (Params, Auth, Headers, Body, Scripts, plus the body tools and certificate chip at its
 * right end) needs a minimum width. When the column is narrower than that, the response column is hidden so the
 * request column gets the room, instead of the row's two halves drawing over each other.
 */

/** Width the tab row's content takes, in px: the tabs, the right end's visible items, their gaps and the row's padding. */
export function tabRowNeededWidth(row: HTMLElement): number {
  const tabs = row.querySelector<HTMLElement>(".tabs");
  const end = row.querySelector<HTMLElement>(".req-tabs-end");
  const style = getComputedStyle(row);
  const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const rowGap = parseFloat(style.columnGap) || 0;
  let needed = pad + (tabs?.scrollWidth ?? 0);
  if (end) {
    const items = Array.from(end.children).filter((c) => (c as HTMLElement).offsetWidth > 0) as HTMLElement[];
    if (items.length > 0) {
      const gap = parseFloat(getComputedStyle(end).columnGap) || 0;
      needed += rowGap + items.reduce((n, c) => n + c.offsetWidth, 0) + gap * (items.length - 1);
    }
  }
  return Math.ceil(needed);
}

/** Width the request column gets next to the response column for a given inspector width and split (0..1). */
export function unfoldedRequestWidth(inspectorWidth: number, split: number, minColumn: number): number {
  const max = Math.max(minColumn, inspectorWidth - minColumn - 1);
  return Math.min(max, Math.max(minColumn, inspectorWidth * split));
}

/**
 * Whether the response column should be hidden. `hidden` is the current state, `neededPx` what the tab row needs,
 * `rowWidthPx` what it has now, and `requestWidthIfShownPx` what the request column would get with the response back.
 * Hidden stays hidden until the request column would fit its tab row with the response shown again, so it never flickers.
 */
export function nextResponseHidden(hidden: boolean, neededPx: number, rowWidthPx: number, requestWidthIfShownPx: number): boolean {
  if (!hidden) return neededPx > rowWidthPx + 0.5;
  return requestWidthIfShownPx < neededPx;
}
