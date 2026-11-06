import { useSyncExternalStore } from "react";
import { load, save } from "./storage";

/**
 * Which side panel (Variables or Certificates) is open. Only one is open at a time, so opening one closes the other.
 * The rail buttons, the panels and the URL bar's unfilled dot all share this state.
 */
export type SidePanel = "variables" | "certificates";

const VARIABLES_KEY = "rest-runner.variables-panel";
export const CERTS_PANEL_KEY = "rest-runner.certs-panel";

type State = Record<SidePanel, boolean>;

function initial(): State {
  const variables = load<{ open?: boolean }>(VARIABLES_KEY, {}).open === true;
  const certificates = load<{ open?: boolean }>(CERTS_PANEL_KEY, {}).open === true;
  // Both remembered open (should not happen): keep Variables.
  return { variables, certificates: certificates && !variables };
}

let state: State = initial();
const listeners = new Set<() => void>();

function set(next: State) {
  if (next.variables === state.variables && next.certificates === state.certificates) return;
  state = next;
  save(CERTS_PANEL_KEY, { open: state.certificates });
  listeners.forEach((l) => l());
}

export function openSidePanel(panel: SidePanel): void {
  set({ variables: panel === "variables", certificates: panel === "certificates" });
}

export function closeSidePanel(panel: SidePanel): void {
  set({ ...state, [panel]: false });
}

export function toggleSidePanel(panel: SidePanel): void {
  if (state[panel]) closeSidePanel(panel);
  else openSidePanel(panel);
}

export function getSidePanels(): State {
  return state;
}

export function useSidePanels(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
