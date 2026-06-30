import type React from "react";
import { useState, useEffect, useCallback } from "react";
import type { BudgetEnvelopeData, AIJobData } from "../api.js";

export function BudgetSettings(): React.JSX.Element {
  const [envelope, setEnvelope] = useState<BudgetEnvelopeData | null>(null);
  const [usage, setUsage] = useState<{ date: string; tokensUsed: number; spendUsd: number } | null>(null);
  const [jobs, setJobs] = useState<AIJobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await window.api.ai.getBudgetEnvelope();
    if (result) {
      setEnvelope(result.envelope);
      setUsage(result.usage);
    }
    const jobList = await window.api.ai.getJobs();
    setJobs(jobList);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading) {
    return (
      <div style={{ padding: "var(--sp-xl)", color: "var(--text-tertiary)" }}>
        Loading budget settings...
      </div>
    );
  }

  const aiMode = envelope?.backgroundAI ?? "off";
  const tokensUsed = usage?.tokensUsed ?? 0;
  const ceiling = envelope?.dailyTokenCeiling;
  const pct = ceiling ? Math.min(100, (tokensUsed / ceiling) * 100) : 0;

  return (
    <div style={{ maxWidth: "640px", padding: "var(--sp-xl)" }}>
      <h2 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-lg)", marginBottom: "var(--sp-md)" }}>
        Budget Envelope
      </h2>

      {/* Status pill */}
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-xs)",
        padding: "4px 12px",
        borderRadius: "12px",
        fontSize: "var(--fs-xs)",
        fontWeight: "var(--fw-medium)",
        marginBottom: "var(--sp-lg)",
        background: aiMode === "off" ? "rgba(180, 80, 80, 0.10)" : aiMode === "local-only" ? "rgba(180, 160, 60, 0.10)" : "rgba(80, 140, 80, 0.10)",
        color: aiMode === "off" ? "#b45050" : aiMode === "local-only" ? "#b4a040" : "#508c50",
      }}>
        <span style={{
          width: "8px", height: "8px", borderRadius: "50%",
          background: aiMode === "off" ? "#b45050" : aiMode === "local-only" ? "#b4a040" : "#508c50",
        }} />
        AI: {aiMode === "off" ? "Off" : aiMode === "local-only" ? "Local Only" : "Cloud"}
        {envelope?.networkBackground ? " \u00b7 Network: On" : " \u00b7 Network: Off"}
      </div>

      {/* Background AI mode */}
      <div style={{ marginBottom: "var(--sp-lg)" }}>
        <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: "var(--fw-medium)", marginBottom: "var(--sp-xs)" }}>
          Background AI
        </label>
        <select
          value={aiMode}
          onChange={(e) => void handleSave({ backgroundAI: e.target.value })}
          disabled={saving}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: "1px solid var(--border-medium)",
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            fontSize: "var(--fs-sm)",
          }}
        >
          <option value="off">Off</option>
          <option value="local-only">Local Only</option>
          <option value="cloud">Cloud</option>
        </select>
      </div>

      {/* Network toggle */}
      <div style={{ marginBottom: "var(--sp-lg)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--sp-sm)", fontSize: "var(--fs-sm)", fontWeight: "var(--fw-medium)" }}>
          <input
            type="checkbox"
            checked={envelope?.networkBackground ?? false}
            onChange={(e) => void handleSave({ networkBackground: e.target.checked })}
            disabled={saving}
          />
          Allow background network requests
        </label>
      </div>

      {/* Daily token ceiling */}
      <div style={{ marginBottom: "var(--sp-lg)" }}>
        <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: "var(--fw-medium)", marginBottom: "var(--sp-xs)" }}>
          Daily Token Ceiling
        </label>
        <input
          type="number"
          value={ceiling ?? ""}
          onChange={(e) => {
            const val = e.target.value ? Number(e.target.value) : undefined;
            void handleSave({ dailyTokenCeiling: val });
          }}
          disabled={saving}
          placeholder="e.g. 10000"
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: "1px solid var(--border-medium)",
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            fontSize: "var(--fs-sm)",
            width: "200px",
          }}
        />
      </div>

      {/* Usage bar */}
      {ceiling && (
        <div style={{ marginBottom: "var(--sp-lg)" }}>
          <div style={{ fontSize: "var(--fs-sm)", fontWeight: "var(--fw-medium)", marginBottom: "var(--sp-xs)" }}>
            Today's Usage: {tokensUsed.toLocaleString()} / {ceiling.toLocaleString()} tokens
          </div>
          <div style={{
            height: "6px",
            borderRadius: "3px",
            background: "var(--border-light)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: "3px",
              background: pct > 80 ? "#b45050" : pct > 50 ? "#b4a040" : "#508c50",
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      {/* Recent AI Jobs */}
      <div>
        <h3 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-md)", marginBottom: "var(--sp-sm)" }}>
          Recent AI Jobs
        </h3>
        {jobs.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--fs-sm)" }}>No AI jobs yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-xs)" }}>
            {jobs.slice(0, 20).map((job) => (
              <div
                key={job.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "var(--sp-xs) var(--sp-sm)",
                  borderRadius: "4px",
                  border: "1px solid var(--border-light)",
                  fontSize: "var(--fs-sm)",
                }}
              >
                <span style={{ fontWeight: "var(--fw-medium)" }}>{job.kind}</span>
                <span style={{
                  padding: "1px 6px",
                  borderRadius: "3px",
                  fontSize: "var(--fs-xs)",
                  background: job.status === "done" ? "rgba(80, 140, 80, 0.10)" : job.status === "failed" ? "rgba(180, 80, 80, 0.10)" : "rgba(180, 160, 60, 0.10)",
                  color: job.status === "done" ? "#508c50" : job.status === "failed" ? "#b45050" : "#b4a040",
                }}>
                  {job.status}
                </span>
                <span style={{ color: "var(--text-tertiary)", fontSize: "var(--fs-xs)" }}>
                  {job.tokensUsed > 0 ? `${job.tokensUsed} tok` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
