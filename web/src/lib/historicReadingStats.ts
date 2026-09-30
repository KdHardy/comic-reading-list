import { localDayKey, startOfLocalDay, startOfLocalWeek } from './readingStats';

export interface HistoricReadingStats {
  longestList: number;
  bestWeek: number;
  longestStreak: number;
}

export function calculateHistoricReadingStats(
  listBookCounts: readonly number[],
  completedDates: readonly (string | null)[]
): HistoricReadingStats {
  const longestList = listBookCounts.reduce((max, count) => Math.max(max, count), 0);

  const weekCounts = new Map<string, number>();
  const readingDays = new Map<string, Date>();

  for (const completedDate of completedDates) {
    if (!completedDate) continue;
    const completedAt = new Date(completedDate);
    if (Number.isNaN(completedAt.getTime())) continue;

    const weekKey = localDayKey(startOfLocalWeek(completedAt));
    weekCounts.set(weekKey, (weekCounts.get(weekKey) ?? 0) + 1);

    const day = startOfLocalDay(completedAt);
    readingDays.set(localDayKey(day), day);
  }

  let bestWeek = 0;
  for (const count of weekCounts.values()) {
    bestWeek = Math.max(bestWeek, count);
  }

  let longestStreak = 0;
  for (const day of readingDays.values()) {
    const previousDay = new Date(day);
    previousDay.setDate(day.getDate() - 1);
    if (readingDays.has(localDayKey(previousDay))) continue;

    // `day` starts a run; count forward through consecutive days.
    let streak = 0;
    const cursor = new Date(day);
    while (readingDays.has(localDayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    longestStreak = Math.max(longestStreak, streak);
  }

  return { longestList, bestWeek, longestStreak };
}
