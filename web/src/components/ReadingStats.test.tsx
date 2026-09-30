import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReadingStats } from './ReadingStats';

const stats = { total: 5, completed: 2, completedThisWeek: 1, currentStreak: 1 };

describe('ReadingStats', () => {
  it('shows the current date gap as the right-most metric', () => {
    render(<ReadingStats stats={stats} currentDateGap={{ months: 15, days: 12 }} />);

    const labels = screen.getAllByRole('term').map((term) => term.textContent);
    expect(labels[labels.length - 1]).toBe('Current date gap');
    expect(screen.getByText('1 yr, 3 mo')).toBeInTheDocument();
  });

  it('shows a placeholder when there is no current date gap', () => {
    render(<ReadingStats stats={stats} currentDateGap={null} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows collection records under their matching metrics', () => {
    render(
      <ReadingStats
        stats={stats}
        currentDateGap={null}
        historicStats={{ longestList: 42, bestWeek: 9, longestStreak: 14 }}
      />
    );

    const detailFor = (label: string) =>
      screen.getByText(label).parentElement?.querySelector('.reading-stat-detail')?.textContent;
    expect(detailFor('Total comics')).toBe('Longest list: 42');
    expect(detailFor('Read this week')).toBe('Best week: 9');
    expect(detailFor('Current streak')).toBe('Longest streak: 14');
    expect(detailFor('Comics read')).toBeUndefined();
  });

  it('shows placeholders while the collection records are loading', () => {
    render(<ReadingStats stats={stats} currentDateGap={null} historicStats={null} />);

    expect(screen.getByText('Longest list: —')).toBeInTheDocument();
    expect(screen.getByText('Best week: —')).toBeInTheDocument();
    expect(screen.getByText('Longest streak: —')).toBeInTheDocument();
  });
});
