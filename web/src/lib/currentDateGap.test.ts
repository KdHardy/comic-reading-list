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

  it('ignores outliers more than six months from the segment median', () => {
    const rows = [
      comic('1990-05-01'),
      comic('2024-01-01'),
      comic('2024-01-16'),
      comic('2024-01-31'),
      comic('2031-01-01'),
    ];

    // Median is Jan 16, 2024; the 1990 and 2031 dates are dropped, leaving an average of Jan 16.
    expect(calculateCurrentDateGap(rows, localDay(2024, 4, 28))).toEqual({ months: 3, days: 12 });
  });

  it('keeps dates exactly six months from the median and drops dates beyond it', () => {
    const atEdge = [comic('2023-07-15'), comic('2024-01-15'), comic('2024-07-15')];
    const pastEdge = [comic('2023-07-14'), comic('2024-01-15'), comic('2024-07-15')];

    // All three are kept: offsets of -184, 0 and +182 days average to Jan 14.
    expect(calculateCurrentDateGap(atEdge, localDay(2024, 1, 14))).toEqual({ months: 0, days: 0 });
    // Jul 14 falls a day outside the window; the average of Jan 15 and Jul 15 is Apr 15.
    expect(calculateCurrentDateGap(pastEdge, localDay(2024, 4, 15))).toEqual({ months: 0, days: 0 });
  });
});

describe('formatDateGap', () => {
  it('formats years and months', () => {
    expect(formatDateGap({ months: 15, days: 0 })).toBe('1 yr, 3 mo');
    expect(formatDateGap({ months: 24, days: 0 })).toBe('2 yr, 0 mo');
    expect(formatDateGap({ months: 0, days: 0 })).toBe('0 yr, 0 mo');
  });

  it('rounds leftover days to the nearest month without showing them', () => {
    expect(formatDateGap({ months: 3, days: 14 })).toBe('0 yr, 3 mo');
    expect(formatDateGap({ months: 3, days: 15 })).toBe('0 yr, 4 mo');
    expect(formatDateGap({ months: 0, days: 20 })).toBe('0 yr, 1 mo');
    // Rounding up can carry into the next year.
    expect(formatDateGap({ months: 11, days: 29 })).toBe('1 yr, 0 mo');
  });

  it('renders a placeholder when there is no gap to show', () => {
    expect(formatDateGap(null)).toBe('—');
  });
});
