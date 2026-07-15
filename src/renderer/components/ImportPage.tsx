import type React from "react";
import { useState } from "react";
import type { ImportResult } from "../api.js";
import { safeCall } from "../utils/safeCall.js";
import { Button } from "./Controls.js";

function ImportGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.5v8M6.8 8.4 10 11.6l3.2-3.2M4 14v2.5h12V14" />
    </svg>
  );
}

export function ImportPage(): React.JSX.Element {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  const chooseVault = async (): Promise<void> => {
    setChoosing(true);
    setTransportError(null);
    const picked = await safeCall(() => window.api.dialog.openDirectory());
    setChoosing(false);
    if (!picked.ok) {
      setTransportError(picked.error);
      return;
    }
    if (picked.value) {
      setVaultPath(picked.value);
      setResult(null);
    }
  };

  const importVault = async (): Promise<void> => {
    if (!vaultPath) return;
    setImporting(true);
    setResult(null);
    setTransportError(null);
    const imported = await safeCall(() => window.api.library.importVault(vaultPath));
    setImporting(false);
    if (!imported.ok) {
      setTransportError(imported.error);
      return;
    }
    setResult(imported.value);
  };

  const reset = (): void => {
    setVaultPath(null);
    setResult(null);
    setTransportError(null);
  };

  return (
    <div className="import-panel">
      <div className="import-source-mark"><ImportGlyph /></div>
      <div className="import-copy">
        <div className="import-heading-row">
          <div>
            <h3>Obsidian notes</h3>
            <p>Copy Markdown notes from an Obsidian vault into this library. Existing files in the vault are left unchanged.</p>
          </div>
          <span className="import-format">Markdown</span>
        </div>

        <ul className="import-details" aria-label="What the import does">
          <li>Preserves note titles and Markdown</li>
          <li>Maps <code>[[wikilinks]]</code> to library note links</li>
          <li>Reports imported, linked, and skipped files</li>
        </ul>

        {vaultPath ? (
          <div className="import-selection">
            <span>Selected vault</span>
            <code title={vaultPath}>{vaultPath}</code>
            <div className="import-actions">
              <Button variant="primary" onClick={() => void importVault()} busy={importing}>
                {importing ? "Importing notes" : result?.ok ? "Import again" : "Import notes"}
              </Button>
              <Button variant="ghost" onClick={() => void chooseVault()} busy={choosing} disabled={importing}>Choose another</Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => void chooseVault()} busy={choosing}>Choose Obsidian vault…</Button>
        )}

        {importing && (
          <div className="import-progress" role="status" aria-live="polite">
            <span className="import-progress-bar" aria-hidden="true"><i /></span>
            <span>Reading Markdown and resolving links…</span>
          </div>
        )}

        {result?.ok && (
          <div className="import-result import-result--success" role="status">
            <span className="import-result-mark" aria-hidden="true">✓</span>
            <div>
              <strong>Import complete</strong>
              <p>{result.imported} notes imported · {result.linksMapped} links resolved{result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}</p>
            </div>
          </div>
        )}

        {result && !result.ok && (
          <div className="import-result import-result--error" role="alert">
            <span className="import-result-mark" aria-hidden="true">!</span>
            <div>
              <strong>Import could not finish</strong>
              <p>{result.errors.join(" ") || "No error detail was returned."}</p>
              <Button size="sm" onClick={() => void importVault()} busy={importing}>Try again</Button>
            </div>
          </div>
        )}

        {transportError && (
          <div className="import-result import-result--error" role="alert">
            <span className="import-result-mark" aria-hidden="true">!</span>
            <div>
              <strong>Could not reach the importer</strong>
              <p>{transportError}</p>
              <div className="import-actions">
                {vaultPath && <Button size="sm" onClick={() => void importVault()} busy={importing}>Try again</Button>}
                <Button size="sm" variant="ghost" onClick={reset}>Start over</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
