import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Environment } from "../../lib/environments";
import type { Vars } from "../../lib/template";
import { addEnvVar, resolveVariable, setEnvVarValue, type ResolvedVariable, type VariableLayer } from "../../lib/variables";
import { useToast } from "../shell/Toast";
import { VariableHoverCard, type HoverTarget } from "./VariableHoverCard";

/** How long the pointer rests on a placeholder before the card opens, and how long it lingers after the pointer leaves. */
const OPEN_MS = 300;
const CLOSE_MS = 150;

/** What the Variables panel needs: reading and editing values. The hover card adds the rest in Requests. */
export interface PanelVariablesApi {
  environments: Environment[];
  activeEnvId: string | null;
  scriptVars: Vars;
  resolve(name: string): ResolvedVariable;
  /** Changes the value in the place that supplies it. */
  setValue(name: string, target: VariableLayer, value: string): void;
  /** Adds a variable to an environment (the active one by default). */
  add(name: string, value: string, secret: boolean, envId?: string | null): void;
  clearScript(name: string): void;
  clearAllScript(): void;
  /** Opens the Variables sidebar, on the request's own variables. */
  showInSidebar(name?: string): void;
}

export interface VariablesApi extends PanelVariablesApi {
  /** The pointer is over a placeholder. */
  hoverShow(name: string, rect: DOMRect, origin: HTMLElement | null): void;
  /** The pointer left the placeholder. */
  hoverLeave(): void;
  /** Opens the card at once and puts focus in it (Ctrl/Cmd+I). */
  hoverOpen(name: string, rect: DOMRect, origin: HTMLElement | null): void;
}

const VariablesContext = createContext<VariablesApi | null>(null);

/** Null outside Requests mode, which is how the other modes stay without variable editing. */
export function useVariables(): VariablesApi | null {
  return useContext(VariablesContext);
}

interface ProviderProps {
  environments: Environment[];
  activeEnvId: string | null;
  scriptVars: Vars;
  setEnvironments: (envs: Environment[]) => void;
  setActiveEnvId: (id: string | null) => void;
  setScriptVars: (vars: Vars) => void;
  onShowInSidebar: (name?: string) => void;
  children: React.ReactNode;
}

interface CoreProps {
  environments: Environment[];
  activeEnvId: string | null;
  scriptVars: Vars;
  setEnvironments: (envs: Environment[]) => void;
  setActiveEnvId: (id: string | null) => void;
  setScriptVars: (vars: Vars) => void;
  onShowInSidebar: (name?: string) => void;
}

/** Reading and editing variables, with a toast and Undo for each change. Testing and Flows use it without the hover card. */
export function useVariablesCore({ environments, activeEnvId, scriptVars, setEnvironments, setActiveEnvId, setScriptVars, onShowInSidebar }: CoreProps): PanelVariablesApi {
  const toast = useToast();
  /** Applies a change and offers to put things back as they were. */
  const change = useCallback(
    (message: string, apply: () => void, undo: () => void) => {
      apply();
      toast.show({ message, onUndo: undo });
    },
    [toast],
  );
  return useMemo<PanelVariablesApi>(
    () => ({
      environments,
      activeEnvId,
      scriptVars,
      resolve: (name) => resolveVariable(name, environments, activeEnvId, scriptVars),
      setValue(name, target, value) {
        if (target.kind === "script") {
          change(`Updated {{${name}}} (script variable)`, () => setScriptVars({ ...scriptVars, [name]: value }), () => setScriptVars(scriptVars));
        } else {
          change(`Updated {{${name}}} in ${target.envName || "(unnamed)"}`, () => setEnvironments(setEnvVarValue(environments, target.envId, target.varId, value)), () => setEnvironments(environments));
        }
      },
      add(name, value, secret, envId = activeEnvId) {
        const r = addEnvVar(environments, envId, name, value, secret);
        const envName = r.envs.find((e) => e.id === r.envId)?.name ?? "";
        change(
          `Added {{${name}}} to ${envName}`,
          () => {
            setEnvironments(r.envs);
            if (activeEnvId === null) setActiveEnvId(r.envId);
          },
          () => {
            setEnvironments(environments);
            setActiveEnvId(activeEnvId);
          },
        );
      },
      clearScript(name) {
        const { [name]: _gone, ...rest } = scriptVars;
        change(`Cleared script variable {{${name}}}`, () => setScriptVars(rest), () => setScriptVars(scriptVars));
      },
      clearAllScript() {
        change("Cleared all script variables", () => setScriptVars({}), () => setScriptVars(scriptVars));
      },
      showInSidebar: onShowInSidebar,
    }),
    [environments, activeEnvId, scriptVars, setEnvironments, setActiveEnvId, setScriptVars, onShowInSidebar, change],
  );
}

export function VariablesProvider({ environments, activeEnvId, scriptVars, setEnvironments, setActiveEnvId, setScriptVars, onShowInSidebar, children }: ProviderProps) {
  const core = useVariablesCore({ environments, activeEnvId, scriptVars, setEnvironments, setActiveEnvId, setScriptVars, onShowInSidebar });
  const [card, setCard] = useState<HoverTarget | null>(null);
  const cardRef = useRef<HoverTarget | null>(null);
  cardRef.current = card;
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  /** Once the card has focus or an edit in it, it stays until it is dismissed. */
  const pinned = useRef(false);
  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  useEffect(() => clearTimers, []);

  const pin = useCallback(() => {
    pinned.current = true;
  }, []);
  const closeCard = useCallback((restoreFocus: boolean) => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    const origin = cardRef.current?.origin;
    pinned.current = false;
    setCard(null);
    if (restoreFocus) origin?.focus();
  }, []);

  const api = useMemo<VariablesApi>(
    () => ({
      ...core,
      hoverShow(name, rect, origin) {
        window.clearTimeout(closeTimer.current);
        if (pinned.current) return;
        const open = cardRef.current;
        if (open && open.name === name) return;
        window.clearTimeout(openTimer.current);
        if (open) setCard({ name, rect, origin, focus: false });
        else openTimer.current = window.setTimeout(() => setCard({ name, rect, origin, focus: false }), OPEN_MS);
      },
      hoverLeave() {
        window.clearTimeout(openTimer.current);
        if (pinned.current) return;
        window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(() => closeCard(false), CLOSE_MS);
      },
      hoverOpen(name, rect, origin) {
        clearTimers();
        pinned.current = false;
        setCard({ name, rect, origin, focus: true });
      },
    }),
    [core, closeCard],
  );

  return (
    <VariablesContext.Provider value={api}>
      {children}
      {card &&
        createPortal(
          <VariableHoverCard
            api={api}
            target={card}
            onEnter={() => window.clearTimeout(closeTimer.current)}
            onLeave={api.hoverLeave}
            onPin={pin}
            onClose={closeCard}
          />,
          document.body,
        )}
    </VariablesContext.Provider>
  );
}
