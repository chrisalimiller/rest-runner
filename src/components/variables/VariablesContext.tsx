import { createContext, useCallback, useContext, useMemo } from "react";
import type { Environment } from "../../lib/environments";
import type { Vars } from "../../lib/template";
import { addEnvVar, resolveVariable, setEnvVarValue, type ResolvedVariable, type VariableLayer } from "../../lib/variables";
import { useToast } from "../shell/Toast";

export interface VariablesApi {
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

export function VariablesProvider({ environments, activeEnvId, scriptVars, setEnvironments, setActiveEnvId, setScriptVars, onShowInSidebar, children }: ProviderProps) {
  const toast = useToast();

  /** Applies a change and offers to put things back as they were. */
  const change = useCallback(
    (message: string, apply: () => void, undo: () => void) => {
      apply();
      toast.show({ message, onUndo: undo });
    },
    [toast],
  );

  const api = useMemo<VariablesApi>(
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

  return <VariablesContext.Provider value={api}>{children}</VariablesContext.Provider>;
}
