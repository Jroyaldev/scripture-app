import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "neutral" | "success" | "warning" | "error";

export interface ToastOptions {
  tone?: ToastTone;
  durationMs?: number;
}

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone: ToastTone;
  durationMs: number;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (
    message: string,
    actionLabel?: string,
    onAction?: () => void,
    options?: ToastOptions,
  ) => void;
  dismissToast: (id: number) => void;
}

export type ShowToast = ToastContextValue["showToast"];

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_DURATION_MS = 5_000;
const EXIT_DURATION_MS = 160;
let toastId = 0;

function ToastMark({ tone }: { tone: ToastTone }): React.JSX.Element {
  if (tone === "success") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.3 6.4 11.2 12.8 4.8" /></svg>;
  }
  if (tone === "error") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" /></svg>;
  }
  if (tone === "warning") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4.1v4.7M8 11.7h.01" /></svg>;
  }
  return <span aria-hidden="true" />;
}

export function ToastProvider({
  children,
  materialClassName = "",
  onShowToastReady,
}: {
  children: ReactNode;
  materialClassName?: string;
  onShowToastReady?: (showToast: ShowToast | null) => void;
}): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [closingIds, setClosingIds] = useState<Set<number>>(new Set());
  const autoTimers = useRef(new Map<number, number>());
  const exitTimers = useRef(new Map<number, number>());

  const removeToast = useCallback((id: number): void => {
    const autoTimer = autoTimers.current.get(id);
    if (autoTimer != null) window.clearTimeout(autoTimer);
    autoTimers.current.delete(id);
    const exitTimer = exitTimers.current.get(id);
    if (exitTimer != null) window.clearTimeout(exitTimer);
    exitTimers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
    setClosingIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const dismissToast = useCallback((id: number): void => {
    const autoTimer = autoTimers.current.get(id);
    if (autoTimer != null) window.clearTimeout(autoTimer);
    autoTimers.current.delete(id);
    setClosingIds((current) => new Set(current).add(id));
    if (exitTimers.current.has(id)) return;
    exitTimers.current.set(id, window.setTimeout(() => removeToast(id), EXIT_DURATION_MS));
  }, [removeToast]);

  const showToast = useCallback(
    (
      message: string,
      actionLabel?: string,
      onAction?: () => void,
      options: ToastOptions = {},
    ): void => {
      const id = ++toastId;
      const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
      const toast: Toast = {
        id,
        message,
        actionLabel,
        onAction,
        tone: options.tone ?? "neutral",
        durationMs,
      };
      setToasts((current) => [...current, toast]);
      autoTimers.current.set(id, window.setTimeout(() => dismissToast(id), durationMs));
    },
    [dismissToast],
  );

  useEffect(() => {
    onShowToastReady?.(showToast);
    return () => onShowToastReady?.(null);
  }, [onShowToastReady, showToast]);

  useEffect(() => () => {
    for (const timer of autoTimers.current.values()) window.clearTimeout(timer);
    for (const timer of exitTimers.current.values()) window.clearTimeout(timer);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <div
        className={`toast-container ${materialClassName}`.trim()}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast--${toast.tone}${closingIds.has(toast.id) ? " is-closing" : ""}`}
            role={toast.tone === "error" ? "alert" : "status"}
            aria-live={toast.tone === "error" ? "assertive" : "polite"}
            data-floating-layer="toast"
            style={{ "--toast-duration": `${toast.durationMs}ms` } as React.CSSProperties}
          >
            <span className="toast-mark"><ToastMark tone={toast.tone} /></span>
            <span className="toast-message">{toast.message}</span>
            {toast.actionLabel && toast.onAction && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.onAction?.();
                  dismissToast(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
            <span className="toast-progress" aria-hidden="true" />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
