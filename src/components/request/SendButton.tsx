import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { RunnerMark } from "../shell/RunnerMark";

interface Props {
  sending: boolean;
  /** What the button says when idle: "Send", "Send to Prod", "⚠ Send". */
  label: string;
  guarded?: boolean;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  onSend: () => void;
  onCancel: () => void;
}

/** How long the runner takes to dash off the end once the response is in. */
const FINISH_MS = 260;

/**
 * Send, which becomes Cancel while the request is in flight. It is one button throughout, so the label can crossfade:
 * the runner from the logo jogs along the bottom edge while it waits and dashes off the end when the response arrives.
 */
export function SendButton({ sending, label, guarded = false, style, disabled = false, title, onSend, onCancel }: Props) {
  const [finishing, setFinishing] = useState(false);
  const was = useRef(sending);
  // A layout effect, so the finish class lands in the same frame as the label returning to Send.
  useLayoutEffect(() => {
    const ended = was.current && !sending;
    was.current = sending;
    if (!ended) return;
    setFinishing(true);
    const t = window.setTimeout(() => setFinishing(false), FINISH_MS);
    return () => window.clearTimeout(t);
  }, [sending]);

  return (
    <button
      className={`send ${sending ? "cancel running" : guarded ? "guarded" : ""} ${finishing ? "finish" : ""}`}
      style={sending ? undefined : style}
      onClick={sending ? onCancel : onSend}
      disabled={!sending && disabled}
      title={sending ? "Cancel the request" : title}
      aria-label={sending ? "Cancel" : label.replace("⚠ ", "")}
    >
      <span className="send-label" aria-hidden>
        <span className="send-a">{label}</span>
        <span className="send-b">Cancel</span>
      </span>
      <span className="send-rail" aria-hidden />
      <RunnerMark live={sending || finishing} />
    </button>
  );
}
