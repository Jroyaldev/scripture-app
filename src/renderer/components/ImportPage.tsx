import type React from "react";
import { useState } from "react";
import type { ImportResult } from "../api.js";

export function ImportPage(): React.JSX.Element {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = async () => {
    const dir = await window.api.dialog.openDirectory();
    if (!dir) return;

    setImporting(true);
    const importResult = await window.api.library.importVault(dir);
    setResult(importResult);
    setImporting(false);
  };

  return (
    <div className="import-panel">
      <h2>Import Obsidian Vault</h2>
      <p>
        Import an existing Obsidian vault into your Scripture Library.
        Wikilinks (<code>[[Target]]</code>, <code>[[Target|Alias]]</code>) are
        automatically mapped to Scripture Library note links.
      </p>

      <button className="import-btn" onClick={handleImport} disabled={importing}>
        {importing ? "Importing..." : "Choose Vault Folder"}
      </button>

      {result && (
        <div style={{ marginTop: "var(--sp-xl)" }}>
          {result.ok ? (
            <>
              <p style={{ color: "var(--healthy)", fontWeight: "var(--fw-medium)" }}>
                Import complete
              </p>
              <ul style={{ marginTop: "var(--sp-sm)", fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
                <li>{result.imported} notes imported</li>
                <li>{result.linksMapped} wikilinks resolved</li>
                {result.skipped > 0 && <li>{result.skipped} files skipped</li>}
              </ul>
            </>
          ) : (
            <p style={{ color: "var(--error)" }}>
              Import failed: {result.errors.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
