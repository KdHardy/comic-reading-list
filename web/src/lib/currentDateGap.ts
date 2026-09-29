import type { Book } from './types';

/** A calendar distance expressed as whole months plus remaining days. */
export interface DateGap {
  months: number;
  days: number;
}

interface CurrentDateGapRow {
  /** `null` for divider entries. */
  book: Pick<Book, 'completed' | 'publish_date'> | null;
}

interface CalendarDate {
  year: number;
  /** 0-based month, matching `Date`. */
  month: number;
  day: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Dates further than this from the segment's median are ignored as outliers. */
const OUTLIER_WINDOW_MONTHS = 6;

/** Parse a stored `date` column value ("YYYY-MM-DD", optionally with a time suffix). */
function parseCalendarDate(value: string | null): CalendarDate | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const candidate = { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
  // Reject impossible calendar dates such as 2020-02-30 instead of rolling them over.
  const normalized = fromEpochDay(toEpochDay(candidate));
  if (
    normalized.year !== candidate.year ||
    normalized.month !== candidate.month ||
    normalized.day !== candidate.day
  ) {
    return null;
  }
  return candidate;
}

function toEpochDay(date: CalendarDate): number {
  return Math.round(Date.UTC(date.year, date.month, date.day) / MS_PER_DAY);
}

function fromEpochDay(epochDay: number): CalendarDate {
  const date = new Date(epochDay * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
}

function localCalendarDate(now: Date): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Add whole months, clamping the day to the target month's length (Jan 31 + 1 mo = Feb 28/29). */
function addMonths(date: CalendarDate, months: number): CalendarDate {
  const totalMonths = date.year * 12 + date.month + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Median of whole days; an even count uses the rounded midpoint of the two middle values. */
function medianEpochDay(epochDays: readonly number[]): number {
  const sorted = [...epochDays].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Absolute calendar distance: whole calendar months first, then the remaining days. */
function calendarGap(a: CalendarDate, b: CalendarDate): DateGap {
  const [start, end] = toEpochDay(a) <= toEpochDay(b) ? [a, b] : [b, a];

  let months = (end.year - start.year) * 12 + (end.month - start.month);
  if (end.day < start.day) months -= 1;
  if (months < 0) months = 0;

  const days = toEpochDay(end) - toEpochDay(addMonths(start, months));
  return { months, days };
}

/**
 * "Current date gap": how far today is from the average publish date of the
 * section you are currently reading.
 *
 * - The current segment is every unread comic from the first unread comic in
 *   list order up to (not including) the next divider, or the end of the list.
 *   Completed comics inside that range are skipped.
 * - The segment's reference date is the mean of its comics' publish dates,
 *   averaged as whole days and rounded to the nearest day. Comics without a
 *   valid date are excluded, as are outliers dated more than six calendar
 *   months before or after the segment's median date.
 * - The gap is the absolute calendar distance between that average date and
 *   today's local calendar date (`now` is injectable for tests).
 *
 * Returns `null` when there is nothing to measure: no unread comics, or no
 * dated comics in the current segment.
 */
export function calculateCurrentDateGap(
  rows: readonly CurrentDateGapRow[],
  now: Date = new Date()
): DateGap | null {
  const firstUnreadIndex = rows.findIndex((row) => row.book !== null && !row.book.completed);
  if (firstUnreadIndex === -1) return null;

  const epochDays: number[] = [];
  for (let i = firstUnreadIndex; i < rows.length; i += 1) {
    const book = rows[i].book;
    if (book === null) break;
    if (book.completed) continue;
    const date = parseCalendarDate(book.publish_date);
    if (date) epochDays.push(toEpochDay(date));
  }
  if (epochDays.length === 0) return null;

  const base = fromEpochDay(medianEpochDay(epochDays));
  const earliest = toEpochDay(addMonths(base, -OUTLIER_WINDOW_MONTHS));
  const latest = toEpochDay(addMonths(base, OUTLIER_WINDOW_MONTHS));
  // The median always falls inside its own window, so at least one date survives.
  const kept = epochDays.filter((day) => day >= earliest && day <= latest);

  const total = kept.reduce((sum, day) => sum + day, 0);
  const averageDate = fromEpochDay(Math.round(total / kept.length));
  return calendarGap(averageDate, localCalendarDate(now));
}

/** Display a gap as "3 mo, 12 d"; `null` renders as an em dash placeholder. */
export function formatDateGap(gap: DateGap | null): string {
  if (!gap) return '—';
  return `${gap.months} mo, ${gap.days} d`;
}
