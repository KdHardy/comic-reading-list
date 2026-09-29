import { formatDateGap, type DateGap } from '../lib/currentDateGap';
import type { ReadingStats as ReadingStatsValues } from '../lib/readingStats';

interface Props {
  stats: ReadingStatsValues;
  currentDateGap: DateGap | null;
}

export function ReadingStats({ stats, currentDateGap }: Props) {
  const metrics = [
    { label: 'Total comics', value: stats.total },
    { label: 'Comics read', value: stats.completed },
    { label: 'Read this week', value: stats.completedThisWeek },
    { label: 'Current streak', value: stats.currentStreak },
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
          </div>
        ))}
      </dl>
    </section>
  );
}
