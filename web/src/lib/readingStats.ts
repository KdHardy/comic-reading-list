import type { Book } from './types';

export interface ReadingStats {
  total: number;
  completed: number;
  completedThisWeek: number;
  currentStreak: number;
}

interface ReadingStatsRow {
  book: Pick<Book, 'completed' | 'completed_date'> | null;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function calculateReadingStats(
  rows: readonly ReadingStatsRow[],
  now: Date = new Date()
): ReadingStats {
  const today = startOfLocalDay(now);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(weekStart.getDate() + 7);

  let total = 0;
  let completed = 0;
  let completedThisWeek = 0;
  const readingDays = new Set<string>();

  for (const row of rows) {
    if (!row.book) continue;
    total += 1;
    if (!row.book.completed) continue;
    completed += 1;

    if (!row.book.completed_date) continue;
    const completedAt = new Date(row.book.completed_date);
    if (Number.isNaN(completedAt.getTime())) continue;

    if (completedAt >= weekStart && completedAt < nextWeekStart) {
      completedThisWeek += 1;
    }
    readingDays.add(localDayKey(completedAt));
  }

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const latestEligibleDay = readingDays.has(localDayKey(today))
    ? today
    : readingDays.has(localDayKey(yesterday))
      ? yesterday
      : null;

  let currentStreak = 0;
  if (latestEligibleDay) {
    const day = new Date(latestEligibleDay);
    while (readingDays.has(localDayKey(day))) {
      currentStreak += 1;
      day.setDate(day.getDate() - 1);
    }
  }

  return {
    total,
    completed,
    completedThisWeek,
    currentStreak,
  };
}
