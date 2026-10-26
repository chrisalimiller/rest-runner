import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import "./shell.css";

export const TOAST_MS = 8000;

export interface ToastOptions {
  message: string;
  /** Shows an Undo button; clicking it runs this and dismisses the toast. */
  onUndo?: () => void;
  /** Runs when the toast goes away without Undo (use it for deletes that must wait, such as saved runs). */
  onExpire?: () => void;
  ms?: number;
}

interface Item extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

function ToastView({ item, onDone }: { item: Item; onDone: (id: number, undone: boolean) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDone(item.id, false), item.ms ?? TOAST_MS);
    return () => clearTimeout(t);
  }, [item, onDone]);
  return (
    <div className="toast" role="status">
      <span className="toast-text">{item.message}</span>
      {item.onUndo && (
        <button className="toast-undo" onClick={() => onDone(item.id, true)}>
          Undo
        </button>
      )}
      <button className="icon-btn toast-close" onClick={() => onDone(item.id, false)} aria-label="Dismiss" title="Dismiss">
        ×
      </button>
    </div>
  );
}

/** Messages with an optional Undo, shown bottom left for eight seconds. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const live = useRef(new Map<number, Item>());

  const done = useCallback((id: number, undone: boolean) => {
    const item = live.current.get(id);
    if (!item) return;
    live.current.delete(id);
    setItems((list) => list.filter((i) => i.id !== id));
    if (undone) item.onUndo?.();
    else item.onExpire?.();
  }, []);

  // Anything still waiting when the app closes counts as expired.
  useEffect(() => {
    const flush = () => {
      for (const item of live.current.values()) item.onExpire?.();
      live.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show: (options) => {
        const item = { ...options, id: next.current++ };
        live.current.set(item.id, item);
        setItems((list) => [...list.slice(-3), item]);
      },
    }),
    [],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite">
        {items.map((i) => (
          <ToastView key={i.id} item={i} onDone={done} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
