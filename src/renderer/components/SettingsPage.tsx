import type React from "react";
import { useState, useEffect, useCallback } from "react";
import type {
  AppSettings,
  BudgetEnvelopeData,
  AIJobData,
  ReadingSize,
  ReadingWidth,
  VerseNumberMode,
} from "../api.js";
import { safeCall } from "../utils/safeCall.js";
import { ImportPage } from "./ImportPage.js";

interface Props {
  libraryPath: string;
  readingSize?: ReadingSize;
  readingWidth?: ReadingWidth;
  verseNumbers?: VerseNumberMode;
  onReadingPrefsChange?: (partial: {
    readingSize?: ReadingSize;
    readingWidth?: ReadingWidth;
    verseNumbers?: VerseNumberMode;
  }) => void;
}

const ACCENT_SWATCHES: { color: AppSettings["accentColor"]; label: string }[] = [
  { color: "blue", label: "Blue" },
  { color: "green", label: "Green" },
  { color: "plum", label: "Plum" },
];

export function SettingsPage({
  libraryPath,
  readingSize = "m",
  readingWidth = "medium",
  verseNumbers = "always",
  onReadingPrefsChange,
}: Props): React.JSX.Element {
  const [envelope, setEnvelope] = useState<BudgetEnvelopeData | null>(null);
  const [usage, setUsage] = useState<{ date: string; tokensUsed: number; spendUsd: number } | null>(null);
  const [jobs, setJobs] = useState<AIJobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accentColor, setAccentColor] = useState<AppSettings["accentColor"]>("blue");

  const load = useCallback(async () => {
    const result = await window.api.ai.getBudgetEnvelope();
    if (result) {
      setEnvelope(result.envelope);
      setUsage(result.usage);
    }
    const jobList = await window.api.ai.getJobs();
    setJobs(jobList);
    const settingsRes = await safeCall(() => window.api.settings.get());
    if (settingsRes.ok) {
      setAccentColor(settingsRes.value.accentColor);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccentChange = async (color: AppSettings["accentColor"]) => {
    setAccentColor(color);
    document.documentElement.style.setProperty("--accent-current", `var(--accent-${color})`);
    await safeCall(() => window.api.settings.set({ accentColor: color }));
  };

  const handleSave = async (updates: Partial<BudgetEnvelopeData>) => {
    if (!envelope) return;
    setSaving(true);
    await window.api.ai.setBudgetEnvelope({
      backgroundAI: updates.backgroundAI ?? envelope.backgroundAI,
      networkBackground: updates.networkBackground ?? envelope.networkBackground,
      dailyTokenCeiling: updates.dailyTokenCeiling ?? envelope.dailyTokenCeiling,
    });
    await load();
    setSaving(false);
  };

  const aiMode = envelope?.backgroundAI ?? "off";
  const tokensUsed = usage?.tokensUsed ?? 0;
  const ceiling = envelope?.dailyTokenCeiling;

  return (
    <div className="settings-page">
      {/* Library Section */}
      <section className="settings-section">
        <h2 className="settings-section-title">Library</h2>
        <div className="settings-row">
          <label className="settings-label">Library Location</label>
          <div className="settings-value-row">
            <code className="settings-path">{libraryPath}</code>
            <button
              className="btn-secondary"
              onClick={async () => {
                const res = await window.api.library.revealInFinder();
                if (!res.ok) alert(`Could not reveal library: ${res.error}`);
              }}
            >
              Reveal in Finder
            </button>
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">Switch Library</label>
          <p className="settings-description">
            Point the app at a different folder. Existing libraries are opened as-is; empty
            folders get a new library. The app reloads afterward to refresh notes,
            highlights, and AI data for the new library.
          </p>
          <button
            className="btn-secondary"
            onClick={async () => {
              const chosen = await window.api.dialog.openDirectory();
              if (!chosen || chosen === libraryPath) return;
              const res = await window.api.library.init(chosen);
              if (res.ok) {
                window.location.reload();
              } else {
                alert(`Switch failed: ${res.error}`);
              }
            }}
          >
            Switch Library…
          </button>
        </div>
        <div className="settings-row">
          <label className="settings-label">Rebuild Index</label>
          <p className="settings-description">
            Rebuilds the search index from your notes and highlights. Safe to run anytime.
          </p>
          <button
            className="btn-secondary"
            onClick={async () => {
              const res = await window.api.library.rebuild();
              if (res.ok) alert("Index rebuilt.");
              else alert(`Rebuild failed: ${res.error}`);
            }}
          >
            Rebuild Now
          </button>
        </div>
      </section>

      {/* Scripture Packages Section */}
      <section className="settings-section">
        <h2 className="settings-section-title">Scripture Packages</h2>
        <div className="package-info-grid">
          <div className="package-info-card">
            <div className="package-info-name">World English Bible</div>
            <div className="package-info-meta">WEB · Public Domain · Format v1</div>
            <div className="package-info-source">Source: TehShrike/world-english-bible</div>
          </div>
          <div className="package-info-card">
            <div className="package-info-name">King James Version</div>
            <div className="package-info-meta">KJV · Public Domain · Format v1</div>
            <div className="package-info-source">Source: aruljohn/Bible-kjv</div>
          </div>
        </div>
      </section>

      {/* AI Budget Section */}
      <section className="settings-section">
        <h2 className="settings-section-title">AI Budget</h2>
        {loading ? (
          <p className="settings-loading">Loading budget settings...</p>
        ) : (
          <>
            <div className="settings-row">
              <div className={`status-pill status-${aiMode === "off" ? "error" : aiMode === "local-only" ? "warning" : "healthy"}`}>
                <span className="status-dot" />
                AI: {aiMode === "off" ? "Off" : aiMode === "local-only" ? "Local Only" : "Cloud"}
                {envelope?.networkBackground ? " · Network: On" : " · Network: Off"}
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label">Background AI</label>
              <select
                className="settings-select"
                value={aiMode}
                onChange={(e) => void handleSave({ backgroundAI: e.target.value })}
                disabled={saving}
              >
                <option value="off">Off</option>
                <option value="local-only">Local Only</option>
                <option value="cloud">Cloud</option>
              </select>
            </div>

            <div className="settings-row">
              <label className="settings-label">
                <input
                  type="checkbox"
                  checked={envelope?.networkBackground ?? false}
                  onChange={(e) => void handleSave({ networkBackground: e.target.checked })}
                  disabled={saving}
                />
                Allow background network requests
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-label">Daily Token Ceiling</label>
              <input
                className="settings-input"
                type="number"
                value={ceiling ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : undefined;
                  void handleSave({ dailyTokenCeiling: val });
                }}
                disabled={saving}
                placeholder="e.g. 10000"
              />
            </div>

            {ceiling && (
              <div className="settings-row">
                <div className="usage-bar-label">
                  Today's Usage: {tokensUsed.toLocaleString()} / {ceiling.toLocaleString()} tokens
                </div>
                <meter
                  className="usage-meter"
                  min={0}
                  max={ceiling}
                  value={Math.min(tokensUsed, ceiling)}
                  low={ceiling * 0.5}
                  high={ceiling * 0.8}
                  optimum={0}
                  aria-label="Daily token usage"
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* Recent AI Jobs */}
      <section className="settings-section">
        <h2 className="settings-section-title">Recent AI Jobs</h2>
        {jobs.length === 0 ? (
          <p className="settings-empty">No AI jobs yet.</p>
        ) : (
          <div className="jobs-list">
            {jobs.slice(0, 20).map((job) => (
              <div key={job.id} className="job-item">
                <span className="job-kind">{job.kind}</span>
                <span className={`job-status job-status-${job.status}`}>{job.status}</span>
                <span className="job-tokens">{job.tokensUsed > 0 ? `${job.tokensUsed} tok` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Appearance Section */}
      <section className="settings-section">
        <h2 className="settings-section-title">Appearance</h2>
        <div className="settings-row">
          <label className="settings-label">Accent Color</label>
          <div className="accent-swatch-row">
            {ACCENT_SWATCHES.map((s) => (
              <button
                key={s.color}
                className={`accent-swatch accent-swatch-${s.color}${accentColor === s.color ? " active" : ""}`}
                onClick={() => void handleAccentChange(s.color)}
                title={s.label}
                aria-label={`${s.label} accent`}
              />
            ))}
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">Reading size</label>
          <p className="settings-description">Also available from the Aa control in the reading topbar.</p>
          <div className="rc-segmented settings-segmented" role="group" aria-label="Reading size">
            {(["s", "m", "l"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`rc-seg${readingSize === id ? " active" : ""}`}
                onClick={() => onReadingPrefsChange?.({ readingSize: id })}
                aria-pressed={readingSize === id}
              >
                {id.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">Column width</label>
          <div className="rc-segmented settings-segmented" role="group" aria-label="Column width">
            {([
              ["narrow", "Narrow"],
              ["medium", "Medium"],
              ["wide", "Wide"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rc-seg${readingWidth === id ? " active" : ""}`}
                onClick={() => onReadingPrefsChange?.({ readingWidth: id })}
                aria-pressed={readingWidth === id}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">Verse numbers</label>
          <div className="rc-segmented settings-segmented" role="group" aria-label="Verse numbers">
            {([
              ["always", "Always"],
              ["faint", "Faint"],
              ["hover", "Hover"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rc-seg${verseNumbers === id ? " active" : ""}`}
                onClick={() => onReadingPrefsChange?.({ verseNumbers: id })}
                aria-pressed={verseNumbers === id}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Import lives under Settings so primary nav stays study-focused */}
      <section className="settings-section">
        <h2 className="settings-section-title">Import</h2>
        <ImportPage />
      </section>

      {/* About Section */}
      <section className="settings-section">
        <h2 className="settings-section-title">About</h2>
        <div className="settings-row">
          <label className="settings-label">App Version</label>
          <span className="settings-value">0.1.0</span>
        </div>
        <div className="settings-row">
          <label className="settings-label">Reference Format</label>
          <span className="settings-value">bref:v1</span>
        </div>
        <div className="settings-row">
          <label className="settings-label">App Schema Version</label>
          <span className="settings-value">1</span>
        </div>
        <div className="settings-row">
          <label className="settings-label">Package Format Version</label>
          <span className="settings-value">1</span>
        </div>
      </section>
    </div>
  );
}
