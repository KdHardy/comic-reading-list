import { formatDateGap, type DateGap } from '../lib/currentDateGap';
import type { HistoricReadingStats } from '../lib/historicReadingStats';
import type { ReadingStats as ReadingStatsValues } from '../lib/readingStats';

interface Props {
  stats: ReadingStatsValues;
  currentDateGap: DateGap | null;
  historicStats?: HistoricReadingStats | null;
}

interface Metric {
  label: string;
  value: string | number;
  detail?: string;
}

export function ReadingStats({ stats, currentDateGap, historicStats = null }: Props) {
  const record = (value: number | undefined) => value ?? '—';

  const metrics: Metric[] = [
    { label: 'Total comics', value: stats.total, detail: `Longest list: ${record(historicStats?.longestList)}` },
    { label: 'Comics read', value: stats.completed },
    { label: 'Read this week', value: stats.completedThisWeek, detail: `Best week: ${record(historicStats?.bestWeek)}` },
    {
      label: 'Current streak',
      value: stats.currentStreak,
      detail: `Longest streak: ${record(historicStats?.longestStreak)}`,
    },
    { label: 'Current date gap', value: formatDateGap(currentDateGap) },
  ];

  return (
    <section className="reading-stats" aria-labelledby="reading-stats-heading">
      <h2 id="reading-stats-heading" className="visually-hidden">
        Current list reading statistics
      </h2>
      <dl className="reading-stats-list">
        {metrics.map((metric) => (
          <div className="reading-stat" key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
            {metric.detail && <dd className="reading-stat-detail">{metric.detail}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
