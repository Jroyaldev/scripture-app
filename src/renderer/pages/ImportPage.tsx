import React, { useState, useCallback } from "react";
import type { ImportResult } from "../api.js";

export function ImportPage(): React.JSX.Element {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleImport = useCallback(async () => {
    const path = await window.api.dialog.openDirectory();
    if (!path) return;

    setLoading(true);
    const res = await window.api.library.importVault(path);
    setResult(res);
    setLoading(false);
  }, []);

  return (
    <div style={{ flex: 1 }}>
      <div className="import-panel">
        <h2>Import Obsidian Vault</h2>
        <p>
          Import notes from an Obsidian vault into your Scripture Library.
          Wikilinks (<code>{"[[Target Note]]"}</code>) will be mapped to
          note links (<code>{"[[note:ULID|label]]"}</code>), frontmatter
          will be preserved, and scripture references in note bodies will
          be parsed automatically.
        </p>

        <button className="import-btn" onClick={handleImport} disabled={loading}>
          {loading ? "Importing..." : "Choose Vault Folder"}
        </button>

        {result && (
          <div style={{ marginTop: "var(--sp-xl)" }}>
            <div style={{
              padding: "var(--sp-md)", borderRadius: "var(--radius-md)",
              background: result.ok ? "rgba(90, 139, 90, 0.08)" : "rgba(184, 90, 90, 0.08)",
              border: `1px solid ${result.ok ? "rgba(90, 139, 90, 0.2)" : "rgba(184, 90, 90, 0.2)"}`,
            }}>
              <div style={{ fontWeight: "var(--fw-semibold)", marginBottom: "var(--sp-sm)" }}>
                {result.ok ? "Import Complete" : "Import Failed"}
              </div>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
                <div>Notes imported: {result.imported}</div>
                <div>Notes skipped: {result.skipped}</div>
                <div>Links mapped: {result.linksMapped}</div>
              </div>
              {result.errors.length > 0 && (
                <div style={{ marginTop: "var(--sp-sm)", fontSize: "var(--fs-xs)", color: "var(--error)" }}>
                  {result.errors.map((err, i) => <div key={i}>{err}</div>)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
