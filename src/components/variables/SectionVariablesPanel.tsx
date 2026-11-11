import { useCallback } from "react";
import { type Environment } from "../../lib/environments";
import { openSidePanel } from "../../lib/sidePanels";
import { useVariablesCore } from "./VariablesContext";
import { showOwnVariables, VariablesPanel } from "./VariablesPanel";

interface Props {
  environments: Environment[];
  activeEnvId: string | null;
  setEnvironments: (envs: Environment[]) => void;
  setActiveEnvId: (id: string | null) => void;
  /** Placeholders the open suite or flow uses. */
  used: string[];
  /** Tools: the tool's inputs, listed as the placeholders it fills itself. */
  inputs?: string[];
  /** "This suite" or "This flow". */
  scope: string;
  onEditEnvironments: (varId?: string) => void;
}

const NO_SCRIPT_VARS = {};

/**
 * The Variables panel for Testing and Flows. It shows the environment selected in that section and edits the shared
 * environment list. Script variables belong to Requests, so they are left out.
 */
export function SectionVariablesPanel({ environments, activeEnvId, setEnvironments, setActiveEnvId, used, scope, inputs, onEditEnvironments }: Props) {
  const onShowInSidebar = useCallback(() => {
    showOwnVariables();
    openSidePanel("variables");
  }, []);
  const api = useVariablesCore({ environments, activeEnvId, scriptVars: NO_SCRIPT_VARS, setEnvironments, setActiveEnvId, setScriptVars: () => {}, onShowInSidebar });
  return <VariablesPanel api={api} used={used} inputs={inputs} scope={scope} showScript={false} onEditEnvironments={onEditEnvironments} onSwitchEnvironment={setActiveEnvId} />;
}
