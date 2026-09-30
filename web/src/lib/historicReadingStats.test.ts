import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculateHistoricReadingStats } from './historicReadingStats';

const originalTimezone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'UTC';
});

afterAll(() => {
  process.env.TZ = originalTimezone;
});

describe('calculateHistoricReadingStats', () => {
  it('returns zeroed records for an empty collection', () => {
    expect(calculateHistoricReadingStats([], [])).toEqual({
      longestList: 0,
      bestWeek: 0,
      longestStreak: 0,
    });
  });

  it('uses the largest list size as the longest list', () => {
    expect(calculateHistoricReadingStats([4, 27, 12], []).longestList).toBe(27);
  });

  it('groups best week on Sunday boundaries', () => {
    const dates = [
      // Saturday 2024-01-13 closes one week...
      '2024-01-13T10:00:00Z',
      '2024-01-13T11:00:00Z',
      // ...Sunday 2024-01-14 starts the next one.
      '2024-01-14T10:00:00Z',
      '2024-01-15T10:00:00Z',
      '2024-01-20T23:00:00Z',
    ];

    expect(calculateHistoricReadingStats([], dates).bestWeek).toBe(3);
  });

  it('counts several reads on one day once for streaks', () => {
    const dates = ['2024-01-10T08:00:00Z', '2024-01-10T20:00:00Z', '2024-01-11T08:00:00Z'];

    expect(calculateHistoricReadingStats([], dates).longestStreak).toBe(2);
  });

  it('finds the longest streak anywhere in history, not just the latest run', () => {
    const dates = [
      '2023-03-01T12:00:00Z',
      '2023-03-02T12:00:00Z',
      '2023-03-03T12:00:00Z',
      '2023-03-04T12:00:00Z',
      // gap on 2023-03-05 breaks the run
      '2023-03-06T12:00:00Z',
      '2024-01-09T12:00:00Z',
      '2024-01-10T12:00:00Z',
    ];

    expect(calculateHistoricReadingStats([], dates).longestStreak).toBe(4);
  });

  it('carries streaks across month and year boundaries', () => {
    const dates = ['2023-12-31T12:00:00Z', '2024-01-01T12:00:00Z', '2024-01-02T12:00:00Z'];

    expect(calculateHistoricReadingStats([], dates).longestStreak).toBe(3);
  });

  it('ignores missing and invalid dates', () => {
    const dates = [null, 'not-a-date', '2024-01-10T12:00:00Z'];

    expect(calculateHistoricReadingStats([], dates)).toEqual({
      longestList: 0,
      bestWeek: 1,
      longestStreak: 1,
    });
  });
});
