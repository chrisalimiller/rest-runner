import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { maskSecrets, storedSecrets } from "../../lib/secrets";
import { sourceLabel, type VariableSource } from "../../lib/variables";
import type { VariablesApi } from "./VariablesContext";
import "./variables.css";

export interface HoverTarget {
  name: string;
  rect: DOMRect;
  /** The field the placeholder is in, so closing can hand focus back to it. */
  origin: HTMLElement | null;
  /** Opened from the keyboard: the card's value field takes focus. */
  focus: boolean;
}

interface Props {
  api: VariablesApi;
  target: HoverTarget;
  batchColumns?: string[];
  onEnter: () => void;
  onLeave: () => void;
  onPin: () => void;
  onClose: (restoreFocus: boolean) => void;
}

const WIDTH = 300;
const MARGIN = 8;

/** Value and source of a {{variable}}, editable in place. */
export function VariableHoverCard({ api, target, batchColumns, onEnter, onLeave, onPin, onClose }: Props) {
  const { name } = target;
  const resolved = api.resolve(name);
  const { winner, shadowed } = resolved;
  const secrets = storedSecrets();
  const sensitive = winner ? (winner.kind === "env" ? winner.secret : maskSecrets(winner.value, secrets) !== winner.value) : false;
  const current = winner?.value ?? "";
  const activeEnv = api.environments.find((e) => e.id === api.activeEnvId) ?? null;

  const [draft, setDraft] = useState(current);
  const [reveal, setReveal] = useState(false);
  const [newSecret, setNewSecret] = useState(false);
  const [envId, setEnvId] = useState<string | null>(activeEnv?.id ?? api.environments[0]?.id ?? null);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  // A different variable, or a value changed elsewhere, starts the draft over.
  useEffect(() => {
    setDraft(current);
    setReveal(false);
  }, [name, current]);

  useEffect(() => {
    if (target.focus) {
      input.current?.focus();
      input.current?.select();
      onPin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Below the placeholder, or above it when there is no room, and inside the window either way.
  useLayoutEffect(() => {
    const place = () => {
      const h = ref.current?.offsetHeight ?? 160;
      const r = target.rect;
      const left = Math.min(Math.max(MARGIN, r.left), window.innerWidth - WIDTH - MARGIN);
      const below = r.bottom + 6;
      const above = below + h > window.innerHeight - MARGIN && r.top - 6 - h > MARGIN;
      setPos({ left, top: above ? r.top - 6 - h : below, above });
      // The anchor scrolled out of view.
      if (r.bottom < 0 || r.top > window.innerHeight) onClose(false);
    };
    place();
  }, [target, onClose, current, shadowed.length, winner === null]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose(false);
    };
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const dirty = draft !== current;
  const save = () => {
    if (winner) {
      if (dirty) api.setValue(name, winner, draft);
    } else if (draft !== "") {
      api.add(name, draft, newSecret, envId);
    }
  };
  const source: VariableSource = winner ? (winner.kind === "script" ? { kind: "script" } : { kind: "env", envName: winner.envName }) : { kind: "unset" };
  const masked = (v: string) => maskSecrets(v, secrets);

  return (
    <div
      ref={ref}
      className={`variable-card ${pos?.above ? "above" : ""}`}
      role="dialog"
      aria-label={`Variable ${name}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: WIDTH }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="variable-card-head">
        <code className="var-chip">{name}</code>
        <span className={`source-chip source-${source.kind}`}>{sourceLabel(source)}</span>
      </div>
      <div className="variable-card-field">
        <input
          ref={input}
          className="variables-input mono"
          type={sensitive && !reveal ? "password" : "text"}
          aria-label={`Value of ${name}`}
          placeholder={winner ? undefined : `Value for ${(api.environments.find((e) => e.id === envId)?.name ?? "Environment 1") || "(unnamed)"}`}
          value={draft}
          onFocus={onPin}
          onChange={(e) => {
            onPin();
            setDraft(e.target.value);
          }}
          onBlur={() => {
            if (winner && dirty) save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (dirty || (!winner && draft !== "")) {
                save();
                if (!winner) onClose(true);
              } else onClose(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(current);
              onClose(true);
            }
          }}
        />
        {sensitive && (
          <button className="link-btn small" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
            {reveal ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {!winner && (
        <div className="variable-card-add">
          <label className="small">
            <input type="checkbox" checked={newSecret} onChange={(e) => setNewSecret(e.target.checked)} /> Secret
          </label>
          {api.environments.length > 1 && (
            <select value={envId ?? ""} onChange={(e) => setEnvId(e.target.value)} aria-label="Environment">
              {api.environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name || "(unnamed)"}
                </option>
              ))}
            </select>
          )}
          <button className="link-btn small" disabled={draft === ""} onClick={() => { save(); onClose(true); }}>
            {api.environments.length === 0 ? "Create Environment 1 and add" : `Add to ${(api.environments.find((e) => e.id === envId)?.name ?? "") || "(unnamed)"}`}
          </button>
        </div>
      )}
      {shadowed.map((l) => (
        <div key={l.kind === "env" ? l.varId : "script"} className="muted small">
          Hides <s className="mono">{l.kind === "env" && l.secret ? "••••••" : masked(l.value)}</s> from {l.kind === "env" ? `Env · ${l.envName || "(unnamed)"}` : "Script"}
        </div>
      ))}
      {batchColumns?.includes(name) && <div className="muted small">In the batch run, a CSV column named {name} wins.</div>}
      <div className="hint small muted">{winner ? `Enter saves · Esc cancels · edits the ${winner.kind === "script" ? "script variable" : `value in ${winner.envName || "(unnamed)"}`}` : "Not set by a script or the active environment"}</div>
      <div className="variable-card-links">
        <button className="link-btn small" onClick={() => { api.showInSidebar(name); onClose(false); }}>
          Show in Variables
        </button>
        {winner?.kind === "script" && (
          <button className="link-btn small" onClick={() => { api.clearScript(name); onClose(false); }}>
            Clear script value
          </button>
        )}
      </div>
    </div>
  );
}
