import type React from "react";
import { useState } from "react";
import { safeCall } from "../utils/safeCall.js";
import { Button } from "./Controls.js";

interface Props {
  defaultPath: string;
  onConfirm: (path: string) => Promise<{ ok: boolean; error?: string }>;
  shellClass: string;
}

function WelcomeBookIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5c2-.8 3.6-.8 6 .2v9c-2.4-1-4-1-6-.2z" />
      <path d="M16 5c-2-.8-3.6-.8-6 .2v9c2.4-1 4-1 6-.2z" />
    </svg>
  );
}

function TrustMark({ kind }: { kind: "files" | "local" | "move" }): React.JSX.Element {
  if (kind === "files") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h6l4 4v9H5zM11 3.5v4h4" /></svg>;
  }
  if (kind === "local") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4" width="13" height="9" rx="1.7" /><path d="M7 16h6M10 13v3" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6.5h7.5M9 4l2.5 2.5L9 9M16 13.5H8.5M11 11l-2.5 2.5L11 16" /></svg>;
}

export function WelcomeScreen({ defaultPath, onConfirm, shellClass }: Props): React.JSX.Element {
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUseDefault = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await safeCall(() => onConfirm(defaultPath));
    if (!result.ok || !result.value.ok) {
      setError(result.ok ? (result.value.error ?? "Failed to set up the library.") : result.error);
    }
    setBusy(false);
  };

  const handleChooseFolder = async (): Promise<void> => {
    setChoosing(true);
    setError(null);
    const picked = await safeCall(() => window.api.dialog.openDirectory());
    setChoosing(false);
    if (!picked.ok) {
      setError(picked.error);
      return;
    }
    if (picked.value) setChosenPath(picked.value);
  };

  const handleUseChosen = async (): Promise<void> => {
    if (!chosenPath) return;
    setBusy(true);
    setError(null);
    const result = await safeCall(() => onConfirm(chosenPath));
    if (!result.ok || !result.value.ok) {
      setError(result.ok ? (result.value.error ?? "Failed to set up the library.") : result.error);
    }
    setBusy(false);
  };

  const handlePickAgain = (): void => {
    setChosenPath(null);
    setError(null);
  };

  const path = chosenPath ?? defaultPath;

  return (
    <div className={`${shellClass} welcome-screen`}>
      <main className="welcome-content">
        <header className="welcome-header">
          <div className="welcome-brand-mark"><WelcomeBookIcon /></div>
          <p className="welcome-kicker">Scripture Library</p>
          <h1 className="welcome-title">Your study library stays yours.</h1>
          <p className="welcome-description">
            Scripture keeps your notes, highlights, and study history in a plain local folder. Choose where that folder should live to begin.
          </p>
        </header>

        <div className="welcome-trust-grid" aria-label="Library promises">
          <div><TrustMark kind="files" /><span><strong>Plain files</strong><small>Readable beyond this app</small></span></div>
          <div><TrustMark kind="local" /><span><strong>Local by default</strong><small>Nothing uploaded</small></span></div>
          <div><TrustMark kind="move" /><span><strong>Move anytime</strong><small>One portable folder</small></span></div>
        </div>

        <section className="welcome-location" aria-labelledby="welcome-location-title">
          <div className="welcome-step-heading">
            <span>1</span>
            <div>
              <h2 id="welcome-location-title">Choose your library location</h2>
              <p>{chosenPath ? "Review the folder you chose before creating the library." : "The recommended folder is ready, or choose another place you already back up."}</p>
            </div>
          </div>

          <div className={`welcome-location-choice${chosenPath ? " is-custom" : ""}`}>
            <div className="welcome-location-title-row">
              <span className="welcome-location-icon" aria-hidden="true"><TrustMark kind="local" /></span>
              <div>
                <span>{chosenPath ? "Chosen folder" : "Recommended"}</span>
                <strong>{chosenPath ? "Custom location" : "ScriptureLibrary"}</strong>
              </div>
              {!chosenPath && <span className="welcome-recommended">Recommended</span>}
            </div>
            <code title={path}>{path}</code>
            <div className="welcome-actions">
              {chosenPath ? (
                <>
                  <Button variant="primary" onClick={() => void handleUseChosen()} busy={busy}>Create library here</Button>
                  <Button variant="ghost" onClick={handlePickAgain} disabled={busy || choosing}>Use recommended folder</Button>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={() => void handleUseDefault()} busy={busy}>Use recommended folder</Button>
                  <Button onClick={() => void handleChooseFolder()} busy={choosing} disabled={busy}>Choose another folder…</Button>
                </>
              )}
            </div>
          </div>
        </section>

        {error && (
          <div className="welcome-error" role="alert">
            <span aria-hidden="true">!</span>
            <div><strong>Library setup could not finish</strong><p>{error}</p></div>
          </div>
        )}

        <p className="welcome-footnote">You can reveal, move, or switch libraries later from Settings.</p>
      </main>
    </div>
  );
}
