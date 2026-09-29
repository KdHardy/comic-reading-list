import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReadingStats } from './ReadingStats';

const stats = { total: 5, completed: 2, completedThisWeek: 1, currentStreak: 1 };

describe('ReadingStats', () => {
  it('shows the current date gap as the right-most metric', () => {
    render(<ReadingStats stats={stats} currentDateGap={{ months: 3, days: 12 }} />);

    const labels = screen.getAllByRole('term').map((term) => term.textContent);
    expect(labels[labels.length - 1]).toBe('Current date gap');
    expect(screen.getByText('3 mo, 12 d')).toBeInTheDocument();
  });

  it('shows a placeholder when there is no current date gap', () => {
    render(<ReadingStats stats={stats} currentDateGap={null} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
