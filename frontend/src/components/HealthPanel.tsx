import { useQuery } from '@tanstack/react-query';

import { getHealthStats } from '../api/stats';

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/** Global health panel: active runs + success/failure/duration over the last 24h. */
export function HealthPanel() {
  const statsQuery = useQuery({
    queryKey: ['stats', 'health'],
    queryFn: getHealthStats,
    refetchInterval: 10_000,
  });

  const stats = statsQuery.data;

  const cards = [
    { label: 'Active runs', value: stats ? String(stats.activeRuns) : '…' },
    { label: 'Runs (24h)', value: stats ? String(stats.last24h.total) : '…' },
    {
      label: 'Success rate (24h)',
      value: stats ? formatRate(stats.last24h.successRate) : '…',
      detail: stats ? `${stats.last24h.succeeded} ok · ${stats.last24h.failed} failed` : undefined,
    },
    {
      label: 'Avg duration (24h)',
      value: stats ? formatDuration(stats.last24h.avgDurationMs) : '…',
    },
  ];

  return (
    <section className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-4"
        >
          <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-100">{card.value}</p>
          {card.detail && <p className="mt-1 text-xs text-slate-500">{card.detail}</p>}
        </div>
      ))}
    </section>
  );
}
