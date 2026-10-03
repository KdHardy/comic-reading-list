import type { Book } from './types';

/** Counts for the list being viewed. */
export interface ListReadingStats {
  total: number;
  completed: number;
}

/** Reading activity across every list in the collection. */
export interface ReadingActivity {
  completedThisWeek: number;
  currentStreak: number;
}

interface ReadingStatsRow {
  book: Pick<Book, 'completed'> | null;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfLocalWeek(date: Date): Date {
  const weekStart = startOfLocalDay(date);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  return weekStart;
}

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function calculateListReadingStats(rows: readonly ReadingStatsRow[]): ListReadingStats {
  let total = 0;
  let completed = 0;

  for (const row of rows) {
    if (!row.book) continue;
    total += 1;
    if (row.book.completed) completed += 1;
  }

  return { total, completed };
}

export function calculateReadingActivity(
  completedDates: readonly (string | null)[],
  now: Date = new Date()
): ReadingActivity {
  const today = startOfLocalDay(now);
  const weekStart = startOfLocalWeek(today);
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(weekStart.getDate() + 7);

  let completedThisWeek = 0;
  const readingDays = new Set<string>();

  for (const completedDate of completedDates) {
    if (!completedDate) continue;
    const completedAt = new Date(completedDate);
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

  return { completedThisWeek, currentStreak };
}
