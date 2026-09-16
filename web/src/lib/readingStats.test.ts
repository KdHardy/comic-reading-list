import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculateReadingStats } from './readingStats';

const originalTimezone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'UTC';
});

afterAll(() => {
  process.env.TZ = originalTimezone;
});

function row(completed: boolean, completedDate: string | null = null) {
  return {
    book: {
      completed,
      completed_date: completedDate,
    },
  };
}

describe('calculateReadingStats', () => {
  it('returns zeroed metrics for an empty list', () => {
    expect(calculateReadingStats([], new Date('2024-01-10T12:00:00Z'))).toEqual({
      total: 0,
      completed: 0,
      completedThisWeek: 0,
      currentStreak: 0,
    });
  });

  it('counts total and completed entries in a mixed list', () => {
    const rows = [
      row(true, '2024-01-10T09:00:00Z'),
      row(false),
      row(true, '2023-12-01T09:00:00Z'),
    ];

    expect(calculateReadingStats(rows, new Date('2024-01-10T12:00:00Z'))).toEqual({
      total: 3,
      completed: 2,
      completedThisWeek: 1,
      currentStreak: 1,
    });
  });

  it('excludes divider entries from every comic metric', () => {
    const rows = [
      row(true, '2024-01-10T09:00:00Z'),
      { book: null },
      row(false),
    ];

    expect(calculateReadingStats(rows, new Date('2024-01-10T12:00:00Z'))).toEqual({
      total: 2,
      completed: 1,
      completedThisWeek: 1,
      currentStreak: 1,
    });
  });

  it('uses local Sunday through Saturday as the current week', () => {
    const rows = [
      row(true, '2024-01-06T23:59:59'),
      row(true, '2024-01-07T00:00:00'),
      row(true, '2024-01-13T23:59:59'),
      row(true, '2024-01-14T00:00:00'),
    ];

    expect(calculateReadingStats(rows, new Date('2024-01-10T12:00:00')).completedThisWeek).toBe(2);
  });

  it('counts entries per week but distinct consecutive reading days for the streak', () => {
    const rows = [
      row(true, '2024-01-10T08:00:00'),
      row(true, '2024-01-10T20:00:00'),
      row(true, '2024-01-09T12:00:00'),
    ];

    expect(calculateReadingStats(rows, new Date('2024-01-10T22:00:00'))).toMatchObject({
      completedThisWeek: 3,
      currentStreak: 2,
    });
  });

  it('continues a streak whose latest reading day is today', () => {
    const rows = [
      row(true, '2024-04-03T07:00:00'),
      row(true, '2024-04-02T07:00:00'),
      row(true, '2024-04-01T07:00:00'),
    ];

    expect(calculateReadingStats(rows, new Date('2024-04-03T20:00:00')).currentStreak).toBe(3);
  });

  it('preserves a streak whose latest reading day is yesterday', () => {
    const rows = [
      row(true, '2024-04-02T07:00:00'),
      row(true, '2024-04-01T07:00:00'),
    ];

    expect(calculateReadingStats(rows, new Date('2024-04-03T20:00:00')).currentStreak).toBe(2);
  });

  it('stops at a gap and expires a stale streak', () => {
    const brokenRows = [
      row(true, '2024-04-03T07:00:00'),
      row(true, '2024-04-01T07:00:00'),
    ];
    const staleRows = [
      row(true, '2024-04-01T07:00:00'),
      row(true, '2024-03-31T07:00:00'),
    ];
    const now = new Date('2024-04-03T20:00:00');

    expect(calculateReadingStats(brokenRows, now).currentStreak).toBe(1);
    expect(calculateReadingStats(staleRows, now).currentStreak).toBe(0);
  });

  it('assigns offset timestamps to the local day they represent', () => {
    const rows = [
      row(true, '2024-01-07T23:30:00-05:00'),
      row(true, '2024-01-07T23:30:00+05:00'),
    ];

    expect(calculateReadingStats(rows, new Date('2024-01-08T12:00:00Z'))).toMatchObject({
      completedThisWeek: 2,
      currentStreak: 2,
    });
  });
});
