/** Where the canvas looks when a flow opens, and when the fit-view button is pressed. */

/** Below this zoom a flow doesn't fit readably, so it opens at zoom 1 on Start instead of shrinking to fit. */
export const READABLE_ZOOM = 0.7;
/** Manual zoom goes no lower than this. */
export const MIN_ZOOM = 0.3;
/** Below this zoom cards switch to a compact rendering. */
export const COMPACT_ZOOM = 0.6;
/** Padding around a fitted flow, as a share of the view. */
export const FIT_PADDING = 0.15;

/** Gap between the left edge of the view and Start when a big flow opens at zoom 1. */
export const START_LEFT_MARGIN = 48;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type InitialView = { kind: "fit" } | { kind: "centre"; x: number; y: number; zoom: 1 };

/** The zoom that would fit `bounds` into `view` with the standard padding. */
export function fitZoom(bounds: Box, view: { width: number; height: number }): number {
  if (bounds.width <= 0 || bounds.height <= 0 || view.width <= 0 || view.height <= 0) return 1;
  const usable = 1 - 2 * FIT_PADDING;
  return Math.min((view.width * usable) / bounds.width, (view.height * usable) / bounds.height);
}

/**
 * Fit the whole flow when it stays readable (zoom 0.7 or more), otherwise zoom 1 with Start near the left edge,
 * vertically centred (or centred on the flow when it has no Start).
 */
export function chooseView(bounds: Box, view: { width: number; height: number }, start: Box | null): InitialView {
  if (fitZoom(bounds, view) >= READABLE_ZOOM) return { kind: "fit" };
  if (!start) return { kind: "centre", x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, zoom: 1 };
  // Start sits near the left edge, so the flow runs to the right into view.
  return { kind: "centre", x: start.x + view.width / 2 - START_LEFT_MARGIN, y: start.y + start.height / 2, zoom: 1 };
}
