import type React from "react";
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, actionLabel?: string, onAction?: () => void) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, actionLabel?: string, onAction?: () => void) => {
      const id = ++toastId;
      const toast: Toast = { id, message, actionLabel, onAction };
      setToasts((prev) => [...prev, toast]);
      // Auto-dismiss after 5s
      setTimeout(() => dismissToast(id), 5000);
    },
    [dismissToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span className="toast-message">{t.message}</span>
            {t.actionLabel && t.onAction && (
              <button
                className="toast-action"
                onClick={() => {
                  t.onAction!();
                  dismissToast(t.id);
                }}
              >
                {t.actionLabel}
              </button>
            )}
            <button className="toast-close" onClick={() => dismissToast(t.id)}>
              ×
            </button>
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
