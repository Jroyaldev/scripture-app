import type React from "react";
import { useState } from "react";

interface Props {
  defaultPath: string;
  onConfirm: (path: string) => Promise<{ ok: boolean; error?: string }>;
  shellClass: string;
}

function WelcomeBookIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5c2-.8 3.6-.8 6 .2v9c-2.4-1-4-1-6-.2z" />
      <path d="M16 5c-2-.8-3.6-.8-6 .2v9c2.4-1 4-1 6-.2z" />
    </svg>
  );
}

export function WelcomeScreen({ defaultPath, onConfirm, shellClass }: Props): React.JSX.Element {
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUseDefault = async () => {
    setBusy(true);
    setError(null);
    const result = await onConfirm(defaultPath);
    if (!result.ok) {
      setError(result.error ?? "Failed to set up the library.");
    }
    setBusy(false);
  };

  const handleChooseFolder = async () => {
    setError(null);
    const picked = await window.api.dialog.openDirectory();
    if (picked) {
      setChosenPath(picked);
    }
  };

  const handleUseChosen = async () => {
    if (!chosenPath) return;
    setBusy(true);
    setError(null);
    const result = await onConfirm(chosenPath);
    if (!result.ok) {
      setError(result.error ?? "Failed to set up the library.");
    }
    setBusy(false);
  };

  const handlePickAgain = () => {
    setChosenPath(null);
    setError(null);
  };

  return (
    <div className={`${shellClass} welcome-screen`}>
      <div className="welcome-content">
        <div className="welcome-brand-mark">
          <WelcomeBookIcon />
        </div>
        <h1 className="welcome-title">Welcome to Scripture Library</h1>
        <p className="welcome-description">
          This is a local-first scripture study tool. Your notes, highlights, and margin
          data live in a plain folder on your machine — nothing is uploaded anywhere.
        </p>

        {chosenPath === null ? (
          <div className="welcome-actions">
            <button
              className="btn-primary welcome-default-btn"
              onClick={() => void handleUseDefault()}
              disabled={busy}
              title={defaultPath}
            >
              Use Default Location
              <span className="welcome-path-inline" title={defaultPath}>
                {defaultPath}
              </span>
            </button>
            <button
              className="btn-secondary"
              onClick={() => void handleChooseFolder()}
              disabled={busy}
            >
              Choose a Different Folder…
            </button>
          </div>
        ) : (
          <div className="welcome-actions">
            <div className="welcome-chosen-path" title={chosenPath}>
              {chosenPath}
            </div>
            <button
              className="btn-primary"
              onClick={() => void handleUseChosen()}
              disabled={busy}
            >
              Use This Location
            </button>
            <button
              className="btn-secondary"
              onClick={handlePickAgain}
              disabled={busy}
            >
              Choose Again…
            </button>
          </div>
        )}

        {busy && (
          <div className="welcome-loading">
            <span className="loading-spinner-sm" />
            <span className="loading-text-inline">Setting up your library…</span>
          </div>
        )}

        {error && <p className="welcome-error">{error}</p>}
      </div>
    </div>
  );
}
