/**
 * The item to keep selected in a filtered list: the current one while it is still shown,
 * otherwise the first shown item (or nothing), so the detail pane never shows a hidden item.
 */
export function keepSelected<T>(selected: T | null, shown: readonly T[]): T | null {
  return selected !== null && shown.includes(selected) ? selected : (shown[0] ?? null);
}
