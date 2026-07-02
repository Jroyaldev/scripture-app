import { BudgetSettings } from 'scripture-app';

// BudgetSettings loads window.api.ai.getBudgetEnvelope() + getJobs() on mount.
const envelope = {
  backgroundAI: 'local-only',
  dailyTokenCeiling: 50000,
  dailySpendCeilingUsd: 2,
  networkBackground: false,
};
const usage = { date: '2024-03-02', tokensUsed: 12400, spendUsd: 0.18 };
const jobs = [
  { id: 'j1', kind: 'semantic-margin', status: 'done', created: '2024-03-02', finished: '2024-03-02', tokensUsed: 3200, error: null },
  { id: 'j2', kind: 'claim-extraction', status: 'running', created: '2024-03-02', finished: null, tokensUsed: 0, error: null },
  { id: 'j3', kind: 'cross-ref-suggest', status: 'failed', created: '2024-03-01', finished: '2024-03-01', tokensUsed: 900, error: 'network unavailable' },
];

if (typeof window !== 'undefined') {
  (window as any).api = {
    ...(window as any).api,
    ai: {
      ...(((window as any).api || {}).ai || {}),
      getBudgetEnvelope: async () => ({ envelope, usage }),
      getJobs: async () => jobs,
      setBudgetEnvelope: async () => ({ ok: true }),
    },
  };
}

export const Configured = () => (
  <div style={{ maxWidth: 560 }}>
    <BudgetSettings />
  </div>
);
