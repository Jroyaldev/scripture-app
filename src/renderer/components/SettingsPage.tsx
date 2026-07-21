import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AIJobData,
  BudgetEnvelopeData,
  LibrarySummary,
  MarkingSurface,
  ReadingSize,
  ReadingWidth,
  VerseNumberMode,
} from "../api.js";
import type { AppTheme } from "../theme.js";
import { safeCall } from "../utils/safeCall.js";
import { Button, ControlInput, SegmentedControl } from "./Controls.js";
import { ImportPage } from "./ImportPage.js";
import { ThemeChoiceGrid } from "./ThemePicker.js";
import { useToast } from "./Toast.js";

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
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  markingSurface: MarkingSurface;
  onMarkingSurfaceChange: (surface: MarkingSurface) => void;
}

type SettingsSectionId = "library" | "reading" | "intelligence" | "import" | "about";

const SETTINGS_SECTIONS: ReadonlyArray<{ id: SettingsSectionId; label: string }> = [
  { id: "library", label: "Library" },
  { id: "reading", label: "Reading" },
  { id: "intelligence", label: "Intelligence" },
  { id: "import", label: "Import" },
  { id: "about", label: "About" },
];

const READING_PACKAGES = [
  { code: "BSB", name: "Berean Standard Bible", license: "CC0", source: "Berean Bible" },
  { code: "WEB", name: "World English Bible", license: "Public Domain", source: "World English Bible" },
  { code: "KJV", name: "King James Version", license: "Public Domain", source: "aruljohn/Bible-kjv" },
  { code: "YLT", name: "Young’s Literal Translation (1898)", license: "Public Domain", source: "Robert Young" },
  { code: "AKJV", name: "American King James + Strong’s", license: "Public Domain", source: "Stone Engelbrite" },
] as const;

const MARKING_SURFACES: ReadonlyArray<{
  id: MarkingSurface;
  label: string;
  description: string;
}> = [
  { id: "palette", label: "Palette", description: "Appears beside the words you select." },
  { id: "rail", label: "Pen Rail", description: "Keeps a compact tool strip beside the page." },
  { id: "radial", label: "Radial", description: "Surrounds a selection with a focused marking wheel." },
  { id: "dock", label: "Dock", description: "Keeps modes and context along the reading edge." },
];

function MarkingSurfacePreview({ surface }: { surface: MarkingSurface }): React.JSX.Element {
  return (
    <span className={`marking-setting-preview preview-${surface}`} aria-hidden="true">
      <i className="marking-preview-page" />
      <i className="marking-preview-line line-one" />
      <i className="marking-preview-line line-two" />
      <i className="marking-preview-line line-three" />
      <i className="marking-preview-tool tool-one" />
      <i className="marking-preview-tool tool-two" />
      <i className="marking-preview-tool tool-three" />
    </span>
  );
}

function MarkingSurfaceChoiceGrid({
  value,
  onChange,
}: {
  value: MarkingSurface;
  onChange: (surface: MarkingSurface) => void;
}): React.JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number): void => {
    const next = (index + MARKING_SURFACES.length) % MARKING_SURFACES.length;
    const option = MARKING_SURFACES[next];
    if (!option) return;
    onChange(option.id);
    window.setTimeout(() => refs.current[next]?.focus(), 0);
  };
  return (
    <div className="marking-surface-choice-grid" role="radiogroup" aria-label="Marking surface">
      {MARKING_SURFACES.map((option, index) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            className={`marking-surface-choice${selected ? " active" : ""}`}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); move(index + 1); }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); move(index - 1); }
              if (event.key === "Home") { event.preventDefault(); move(0); }
              if (event.key === "End") { event.preventDefault(); move(MARKING_SURFACES.length - 1); }
            }}
          >
            <MarkingSurfacePreview surface={option.id} />
            <span className="marking-surface-choice-copy">
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
            <span className="marking-surface-choice-check" aria-hidden="true">✓</span>
          </button>
        );
      })}
    </div>
  );
}

function SettingsGlyph({ section }: { section: SettingsSectionId }): React.JSX.Element {
  if (section === "library") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.2c2.1-.9 4.3-.8 6.5.4v10c-2.2-1.2-4.4-1.3-6.5-.4zM16.5 5.2c-2.1-.9-4.3-.8-6.5.4v10c2.2-1.2 4.4-1.3 6.5-.4z" /></svg>;
  }
  if (section === "reading") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5h13M6 9h8M7.5 13h5" /></svg>;
  }
  if (section === "intelligence") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M14.6 5.4l-1.4 1.4M6.8 13.2l-1.4 1.4" /><circle cx="10" cy="10" r="3.1" /></svg>;
  }
  if (section === "import") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v8M6.8 8.4 10 11.6l3.2-3.2M4 14v2.5h12V14" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="M10 8.7v4M10 6.2h.01" /></svg>;
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: SettingsSectionId;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <header className="settings-section-heading">
      <span className="settings-section-icon"><SettingsGlyph section={id} /></span>
      <div>
        <h2 id={`${id}-heading`}>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function formatJobKind(kind: string): string {
  return kind
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function SettingsPage({
  libraryPath,
  readingSize = "m",
  readingWidth = "medium",
  verseNumbers = "always",
  onReadingPrefsChange,
  theme,
  onThemeChange,
  markingSurface,
  onMarkingSurfaceChange,
}: Props): React.JSX.Element {
  const { showToast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("library");
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [envelope, setEnvelope] = useState<BudgetEnvelopeData | null>(null);
  const [usage, setUsage] = useState<{ date: string; tokensUsed: number; spendUsd: number } | null>(null);
  const [jobs, setJobs] = useState<AIJobData[]>([]);
  const [ceilingDraft, setCeilingDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const libraryName = libraryPath.split(/[\\/]/).filter(Boolean).pop() ?? "Scripture Library";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [budgetResult, jobsResult, summaryResult] = await Promise.all([
      safeCall(() => window.api.ai.getBudgetEnvelope()),
      safeCall(() => window.api.ai.getJobs()),
      safeCall(() => window.api.library.getSummary()),
    ]);

    const failures: string[] = [];
    if (budgetResult.ok && budgetResult.value) {
      setEnvelope(budgetResult.value.envelope);
      setUsage(budgetResult.value.usage);
      setCeilingDraft(budgetResult.value.envelope.dailyTokenCeiling?.toString() ?? "");
    } else {
      failures.push(budgetResult.ok ? "AI budget is unavailable" : budgetResult.error);
    }
    if (jobsResult.ok) setJobs(jobsResult.value);
    else failures.push(jobsResult.error);
    if (summaryResult.ok) setSummary(summaryResult.value);
    else failures.push(summaryResult.error);

    if (failures.length > 0) setLoadError("Some library settings could not be loaded.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const sections = SETTINGS_SECTIONS
      .map(({ id }) => ({ id, node: root.querySelector<HTMLElement>(`#settings-${id}`) }))
      .filter((section): section is { id: SettingsSectionId; node: HTMLElement } => section.node !== null);
    const updateActiveSection = (): void => {
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 3) {
        setActiveSection(SETTINGS_SECTIONS.at(-1)?.id ?? "about");
        return;
      }
      const rootTop = root.getBoundingClientRect().top;
      let current: SettingsSectionId = "library";
      for (const section of sections) {
        if (section.node.getBoundingClientRect().top - rootTop <= 120) current = section.id;
      }
      setActiveSection(current);
    };
    root.addEventListener("scroll", updateActiveSection, { passive: true });
    updateActiveSection();
    return () => root.removeEventListener("scroll", updateActiveSection);
  }, []);

  const goToSection = (id: SettingsSectionId): void => {
    const root = scrollRef.current;
    const section = root?.querySelector<HTMLElement>(`#settings-${id}`);
    if (!root || !section) return;
    setActiveSection(id);
    const rootTop = root.getBoundingClientRect().top;
    const compactRailOffset = window.matchMedia("(max-width: 1120px)").matches
      ? (root.querySelector<HTMLElement>(".settings-rail")?.getBoundingClientRect().height ?? 52) + 16
      : 32;
    const nextTop = root.scrollTop + section.getBoundingClientRect().top - rootTop - compactRailOffset;
    root.scrollTo({
      top: nextTop,
      behavior: "auto",
    });
  };

  const persistEnvelope = async (next: BudgetEnvelopeData, successMessage: string): Promise<void> => {
    setSaving(true);
    const result = await safeCall(() => window.api.ai.setBudgetEnvelope({
      backgroundAI: next.backgroundAI,
      networkBackground: next.networkBackground,
      dailyTokenCeiling: next.dailyTokenCeiling,
    }));
    setSaving(false);
    if (!result.ok || !result.value.ok) {
      showToast(result.ok ? (result.value.error ?? "Could not save AI settings.") : result.error, undefined, undefined, { tone: "error" });
      return;
    }
    setEnvelope(next);
    setCeilingDraft(next.dailyTokenCeiling?.toString() ?? "");
    showToast(successMessage, undefined, undefined, { tone: "success" });
  };

  const saveCeiling = (): void => {
    if (!envelope) return;
    const trimmed = ceilingDraft.trim();
    const parsed = trimmed === "" ? undefined : Number(trimmed);
    if (parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed <= 0)) {
      showToast("Enter a whole number greater than zero, or leave the field empty.", undefined, undefined, { tone: "error" });
      return;
    }
    void persistEnvelope({ ...envelope, dailyTokenCeiling: parsed }, "Daily AI limit saved.");
  };

  const revealLibrary = async (): Promise<void> => {
    setRevealing(true);
    const result = await safeCall(() => window.api.library.revealInFinder());
    setRevealing(false);
    if (!result.ok || !result.value.ok) {
      showToast(result.ok ? (result.value.error ?? "Could not reveal the library.") : result.error, undefined, undefined, { tone: "error" });
    }
  };

  const switchLibrary = async (): Promise<void> => {
    const picked = await safeCall(() => window.api.dialog.openDirectory());
    if (!picked.ok) {
      showToast(picked.error, undefined, undefined, { tone: "error" });
      return;
    }
    const chosen = picked.value;
    if (!chosen || chosen === libraryPath) return;
    setSwitching(true);
    const result = await safeCall(() => window.api.library.init(chosen));
    if (!result.ok || !result.value.ok) {
      setSwitching(false);
      showToast(result.ok ? (result.value.error ?? "Switch failed.") : result.error, undefined, undefined, { tone: "error" });
      return;
    }
    window.location.reload();
  };

  const rebuildIndex = async (): Promise<void> => {
    setRebuilding(true);
    const result = await safeCall(() => window.api.library.rebuild());
    setRebuilding(false);
    if (!result.ok || !result.value.ok) {
      showToast(result.ok ? (result.value.error ?? "Index rebuild failed.") : result.error, undefined, undefined, { tone: "error" });
      return;
    }
    showToast("Search index rebuilt from your library.", undefined, undefined, { tone: "success" });
  };

  const aiMode = envelope?.backgroundAI ?? "off";
  const tokensUsed = usage?.tokensUsed ?? 0;
  const ceiling = envelope?.dailyTokenCeiling;
  const ceilingDirty = ceilingDraft.trim() !== (ceiling?.toString() ?? "");

  return (
    <div className="settings-page" ref={scrollRef}>
      <div className="settings-frame">
        <aside className="settings-rail" aria-label="Settings sections">
          <div className="settings-rail-heading">
            <span>Local library</span>
            <strong>{libraryName}</strong>
          </div>
          <nav>
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? "active" : ""}
                onClick={() => goToSection(section.id)}
                aria-current={activeSection === section.id ? "location" : undefined}
              >
                <SettingsGlyph section={section.id} />
                <span>{section.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings-content">
          <header className="settings-hero">
            <p className="settings-kicker">Library setup</p>
            <h1>Settings</h1>
            <p>Shape your reading desk, manage the local library behind it, and keep automation within clear limits.</p>
          </header>

          {loadError && (
            <div className="settings-load-error" role="alert">
              <span>{loadError}</span>
              <Button size="sm" onClick={() => void load()} busy={loading}>Try again</Button>
            </div>
          )}

          <section id="settings-library" className="settings-section" aria-labelledby="library-heading">
            <SectionHeading
              id="library"
              title="Library"
              description="Your notes, highlights, and study history stay together in one folder on this Mac."
            />

            <div className="settings-library-identity">
              <div className="settings-library-mark" aria-hidden="true"><SettingsGlyph section="library" /></div>
              <div className="settings-library-copy">
                <span>Current library</span>
                <strong>{libraryName}</strong>
                <code title={libraryPath}>{libraryPath}</code>
              </div>
              <Button size="sm" onClick={() => void revealLibrary()} busy={revealing}>Show in Finder</Button>
            </div>

            <dl className="settings-library-stats" aria-label="Library summary">
              <div><dt>Notes</dt><dd>{summary?.notesFound ?? (loading ? "—" : "0")}</dd></div>
              <div><dt>Anchors</dt><dd>{summary?.anchorsFound ?? (loading ? "—" : "0")}</dd></div>
              <div><dt>Highlights</dt><dd>{summary?.highlightsFound ?? (loading ? "—" : "0")}</dd></div>
              <div><dt>Storage</dt><dd>On this Mac</dd></div>
            </dl>

            <div className="settings-subsection">
              <div className="settings-subsection-heading">
                <div>
                  <h3>Installed reading texts</h3>
                  <p>Five bundled translations are available without a network connection.</p>
                </div>
                <span className="settings-count">5 texts</span>
              </div>
              <div className="settings-package-list">
                {READING_PACKAGES.map((pkg) => (
                  <div className="settings-package-row" key={pkg.code}>
                    <span className="settings-package-code">{pkg.code}</span>
                    <span className="settings-package-name">{pkg.name}</span>
                    <span className="settings-package-license">{pkg.license}</span>
                  </div>
                ))}
              </div>
              <details className="settings-disclosure settings-license-disclosure">
                <summary>Licenses and sources</summary>
                <div className="settings-license-list">
                  {READING_PACKAGES.map((pkg) => (
                    <div key={pkg.code}><strong>{pkg.code}</strong><span>{pkg.license}</span><span>{pkg.source}</span></div>
                  ))}
                </div>
              </details>
            </div>

            <div className="settings-subsection settings-maintenance">
              <div className="settings-action-row">
                <div>
                  <h3>Switch library</h3>
                  <p>Open another Scripture Library folder. The app reloads into that library after you choose it.</p>
                </div>
                <Button onClick={() => void switchLibrary()} busy={switching}>Choose folder…</Button>
              </div>
              <div className="settings-action-row">
                <div>
                  <h3>Rebuild search index</h3>
                  <p>Regenerate searchable data from your notes and highlights. Authored files are not changed.</p>
                </div>
                <Button onClick={() => void rebuildIndex()} busy={rebuilding}>Rebuild index</Button>
              </div>
            </div>
          </section>

          <section id="settings-reading" className="settings-section" aria-labelledby="reading-heading">
            <SectionHeading
              id="reading"
              title="Reading"
              description="Change the material and measure of the reading desk without changing Scripture or your anchors."
            />
            <div className="settings-field">
              <div className="settings-field-heading">
                <label>Reading atmosphere</label>
                <p>Material changes. Meaning does not.</p>
              </div>
              <ThemeChoiceGrid theme={theme} onChange={onThemeChange} />
            </div>
            <div className="settings-field">
              <div className="settings-field-heading">
                <label>Marking surface</label>
                <p>Choose how highlight and connection tools meet the reading page.</p>
              </div>
              <MarkingSurfaceChoiceGrid value={markingSurface} onChange={onMarkingSurfaceChange} />
            </div>
            <div className="settings-control-rows">
              <div className="settings-control-row">
                <div><label>Text size</label><p>Also available from the Aa control while reading.</p></div>
                <SegmentedControl
                  label="Reading text size"
                  value={readingSize}
                  options={[
                    { value: "s", content: "Small" },
                    { value: "m", content: "Medium" },
                    { value: "l", content: "Large" },
                  ]}
                  onChange={(value) => onReadingPrefsChange?.({ readingSize: value })}
                  className="settings-segmented"
                />
              </div>
              <div className="settings-control-row">
                <div><label>Reading measure</label><p>Keep long-form reading comfortable for your window.</p></div>
                <SegmentedControl
                  label="Reading measure"
                  value={readingWidth}
                  options={[
                    { value: "narrow", content: "Narrow" },
                    { value: "medium", content: "Medium" },
                    { value: "wide", content: "Wide" },
                  ]}
                  onChange={(value) => onReadingPrefsChange?.({ readingWidth: value })}
                  className="settings-segmented"
                />
              </div>
              <div className="settings-control-row">
                <div><label>Verse numbers</label><p>Choose how strongly verse coordinates appear.</p></div>
                <SegmentedControl
                  label="Verse number visibility"
                  value={verseNumbers}
                  options={[
                    { value: "always", content: "Always" },
                    { value: "faint", content: "Faint" },
                    { value: "hover", content: "On hover" },
                  ]}
                  onChange={(value) => onReadingPrefsChange?.({ verseNumbers: value })}
                  className="settings-segmented"
                />
              </div>
            </div>
          </section>

          <section id="settings-intelligence" className="settings-section" aria-labelledby="intelligence-heading">
            <SectionHeading
              id="intelligence"
              title="Intelligence"
              description="Set explicit limits for background assistance. Scripture and authored notes remain yours."
            />
            {loading && !envelope ? (
              <div className="settings-loading-state" role="status"><span className="loading-spinner-sm" />Loading intelligence limits…</div>
            ) : envelope ? (
              <>
                <div className="settings-ai-summary">
                  <span className={`settings-ai-dot settings-ai-dot--${aiMode}`} aria-hidden="true" />
                  <div>
                    <strong>{aiMode === "off" ? "Background assistance is off" : aiMode === "local-only" ? "Local assistance only" : "Cloud assistance allowed"}</strong>
                    <span>{envelope.networkBackground ? "Background network requests are allowed." : "Background network requests are blocked."}</span>
                  </div>
                </div>

                <div className="settings-control-rows">
                  <div className="settings-control-row">
                    <div><label htmlFor="settings-ai-mode">Background assistance</label><p>Choose whether automated jobs can run and where they may run.</p></div>
                    <select
                      id="settings-ai-mode"
                      className="control-input settings-select-control"
                      value={aiMode}
                      onChange={(event) => void persistEnvelope({ ...envelope, backgroundAI: event.target.value }, "Background assistance updated.")}
                      disabled={saving}
                    >
                      <option value="off">Off</option>
                      <option value="local-only">Local only</option>
                      <option value="cloud">Cloud allowed</option>
                    </select>
                  </div>

                  <div className="settings-control-row">
                    <div>
                      <span className="settings-control-label" id="network-background-label">Background network</span>
                      <p id="network-background-help">Allow background jobs to contact configured network providers.</p>
                    </div>
                    <button
                      type="button"
                      className="settings-switch"
                      role="switch"
                      aria-checked={envelope.networkBackground}
                      aria-labelledby="network-background-label"
                      aria-describedby="network-background-help"
                      disabled={saving}
                      onClick={() => void persistEnvelope({ ...envelope, networkBackground: !envelope.networkBackground }, envelope.networkBackground ? "Background network blocked." : "Background network allowed.")}
                    >
                      <span aria-hidden="true" />
                    </button>
                  </div>

                  <div className="settings-control-row settings-control-row--ceiling">
                    <div><label htmlFor="daily-token-ceiling">Daily token limit</label><p>Leave empty for no token limit. Changes save only when you confirm them.</p></div>
                    <div className="settings-inline-field">
                      <ControlInput
                        id="daily-token-ceiling"
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={ceilingDraft}
                        onChange={(event) => setCeilingDraft(event.target.value)}
                        placeholder="No limit"
                        disabled={saving}
                        aria-invalid={ceilingDraft.trim() !== "" && (!Number.isSafeInteger(Number(ceilingDraft)) || Number(ceilingDraft) <= 0)}
                      />
                      <Button size="sm" onClick={saveCeiling} busy={saving} disabled={!ceilingDirty}>Save</Button>
                    </div>
                  </div>
                </div>

                {ceiling ? (
                  <div className="settings-usage">
                    <div><span>Today</span><strong>{tokensUsed.toLocaleString()} / {ceiling.toLocaleString()} tokens</strong></div>
                    <meter min={0} max={ceiling} value={Math.min(tokensUsed, ceiling)} aria-label="Daily token usage" />
                  </div>
                ) : (
                  <p className="settings-no-limit">No daily token limit is set. Background mode and network permission still apply.</p>
                )}

                <details className="settings-disclosure settings-jobs">
                  <summary><span>Recent activity</span><span>{jobs.length === 0 ? "No jobs" : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}</span></summary>
                  {jobs.length === 0 ? (
                    <p className="settings-empty">Automated study jobs will appear here after they run.</p>
                  ) : (
                    <div className="settings-jobs-list">
                      {jobs.slice(0, 12).map((job) => (
                        <div className="settings-job-row" key={job.id}>
                          <span>{formatJobKind(job.kind)}</span>
                          <span className={`settings-job-status settings-job-status--${job.status}`}>{statusLabel(job.status)}</span>
                          <span>{job.tokensUsed > 0 ? `${job.tokensUsed.toLocaleString()} tok` : "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              </>
            ) : (
              <div className="settings-inline-empty">Intelligence limits are unavailable. Try loading this section again.</div>
            )}
          </section>

          <section id="settings-import" className="settings-section" aria-labelledby="import-heading">
            <SectionHeading
              id="import"
              title="Import"
              description="Bring an existing note collection into this library through an explicit, reviewable action."
            />
            <ImportPage />
          </section>

          <section id="settings-about" className="settings-section" aria-labelledby="about-heading">
            <SectionHeading
              id="about"
              title="About"
              description="Format versions keep this library understandable, portable, and safe to rebuild."
            />
            <dl className="settings-about-list">
              <div><dt>Scripture Library</dt><dd>0.1.0</dd></div>
              <div><dt>Reference coordinates</dt><dd><code>bref:v1</code></dd></div>
              <div><dt>Library schema</dt><dd><code>1</code></dd></div>
              <div><dt>Scripture package format</dt><dd><code>1</code></dd></div>
              <div><dt>Core license</dt><dd>Apache-2.0</dd></div>
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
}
