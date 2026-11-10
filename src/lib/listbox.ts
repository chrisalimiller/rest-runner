// Pure helpers for keyboard navigation in a listbox / custom dropdown.

/** Next active index for a navigation key, or null when the key is not a navigation key. Does not wrap. */
export function moveIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowDown":
      return Math.min(last, current + 1);
    case "ArrowUp":
      return Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/**
 * Type-ahead search. `buffer` is the text typed so far (already including the new character).
 * A single character, or one repeated, cycles through options starting with it; a longer prefix
 * keeps the current option if it still matches. Wraps around. Returns -1 for no match.
 */
export function typeAheadIndex(options: readonly string[], current: number, buffer: string): number {
  const q = buffer.toLowerCase();
  if (!q || options.length === 0) return -1;
  const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0] : q;
  const start = repeated || q.length === 1 ? current + 1 : Math.max(current, 0);
  for (let i = 0; i < options.length; i++) {
    const idx = (start + i) % options.length;
    if (options[idx].toLowerCase().startsWith(needle)) return idx;
  }
  return -1;
}
