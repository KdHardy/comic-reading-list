import { describe, expect, it } from 'vitest';
import { calculateCurrentDateGap, formatDateGap } from './currentDateGap';

function comic(publishDate: string | null, completed = false) {
  return { book: { completed, publish_date: publishDate } };
}

const divider = { book: null };

/** Local calendar "today"; the time of day must not affect the result. */
function localDay(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour);
}

describe('calculateCurrentDateGap', () => {
  it('measures from the segment average date to today', () => {
    const rows = [comic('2000-01-01', true), comic('2024-01-01'), comic('2024-01-31')];

    // Average of Jan 1 and Jan 31 is Jan 16; Jan 16 -> Apr 16 -> Apr 28.
    expect(calculateCurrentDateGap(rows, localDay(2024, 4, 28))).toEqual({ months: 3, days: 12 });
  });

  it('rounds the average to the nearest whole day', () => {
    const halfDay = [comic('2024-01-01'), comic('2024-01-02')];
    const thirdDay = [comic('2024-01-01'), comic('2024-01-01'), comic('2024-01-02')];
    const today = localDay(2024, 1, 10);

    // Mean of 1.5 days rounds up to Jan 2; mean of 1.33 days rounds down to Jan 1.
    expect(calculateCurrentDateGap(halfDay, today)).toEqual({ months: 0, days: 8 });
    expect(calculateCurrentDateGap(thirdDay, today)).toEqual({ months: 0, days: 9 });
  });

  it('ends the segment at the next divider', () => {
    const rows = [comic('2024-01-01'), divider, comic('1990-01-01'), comic('1990-01-01')];

    expect(calculateCurrentDateGap(rows, localDay(2024, 3, 1))).toEqual({ months: 2, days: 0 });
  });

  it('runs to the end of the list when there is no following divider', () => {
    const rows = [
      comic('2000-01-01', true),
      divider,
      comic('2023-06-10'),
      comic('1980-01-01', true),
      comic('2023-06-20'),
    ];

    // Completed comics inside the range are excluded, so the average is Jun 15.
    expect(calculateCurrentDateGap(rows, localDay(2024, 1, 10))).toEqual({ months: 6, days: 26 });
  });

  it('starts at the first unread comic even when earlier sections are finished', () => {
    const rows = [
      comic('2001-01-01', true),
      divider,
      comic('2002-01-01', true),
      comic('2024-02-01'),
      divider,
      comic('1999-01-01'),
    ];

    expect(calculateCurrentDateGap(rows, localDay(2024, 3, 1))).toEqual({ months: 1, days: 0 });
  });

  it('uses the injected today as a local calendar date, ignoring time of day', () => {
    const rows = [comic('2024-01-16')];

    expect(calculateCurrentDateGap(rows, localDay(2024, 4, 28, 0))).toEqual({ months: 3, days: 12 });
    expect(calculateCurrentDateGap(rows, new Date(2024, 3, 28, 23, 59, 59))).toEqual({ months: 3, days: 12 });
    expect(calculateCurrentDateGap(rows, localDay(2025, 4, 28))).toEqual({ months: 15, days: 12 });
  });

  it('counts whole calendar months before days across month boundaries', () => {
    expect(calculateCurrentDateGap([comic('2021-01-31')], localDay(2021, 3, 1))).toEqual({ months: 1, days: 1 });
    expect(calculateCurrentDateGap([comic('2020-01-31')], localDay(2020, 2, 29))).toEqual({ months: 0, days: 29 });
    expect(calculateCurrentDateGap([comic('2020-01-31')], localDay(2020, 3, 31))).toEqual({ months: 2, days: 0 });
    expect(calculateCurrentDateGap([comic('2023-12-15')], localDay(2024, 1, 14))).toEqual({ months: 0, days: 30 });
  });

  it('shows the absolute gap when the average date is after today', () => {
    expect(calculateCurrentDateGap([comic('2024-03-01')], localDay(2024, 1, 31))).toEqual({ months: 1, days: 1 });
  });

  it('returns null when every comic is read', () => {
    const rows = [comic('2020-01-01', true), divider, comic('2020-02-01', true)];

    expect(calculateCurrentDateGap(rows, localDay(2024, 1, 1))).toBeNull();
  });

  it('returns null for an empty list or a list with only dividers', () => {
    expect(calculateCurrentDateGap([], localDay(2024, 1, 1))).toBeNull();
    expect(calculateCurrentDateGap([divider, divider], localDay(2024, 1, 1))).toBeNull();
  });

  it('returns null when no comic in the segment has a usable date', () => {
    const rows = [comic(null), comic('not a date'), comic('2020-02-30'), divider, comic('2020-01-01')];

    expect(calculateCurrentDateGap(rows, localDay(2024, 1, 1))).toBeNull();
  });

  it('excludes comics with missing dates from the average', () => {
    const rows = [comic(null), comic('2024-01-01'), comic(null), comic('2024-01-31')];

    expect(calculateCurrentDateGap(rows, localDay(2024, 2, 16))).toEqual({ months: 1, days: 0 });
  });
});

describe('formatDateGap', () => {
  it('formats months and days', () => {
    expect(formatDateGap({ months: 3, days: 12 })).toBe('3 mo, 12 d');
    expect(formatDateGap({ months: 0, days: 0 })).toBe('0 mo, 0 d');
  });

  it('renders a placeholder when there is no gap to show', () => {
    expect(formatDateGap(null)).toBe('—');
  });
});
