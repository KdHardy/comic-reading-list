// Pure matching rules for Stuart. No I/O here, so this file is unit-tested
// from the web app's Vitest suite (supabase/functions/stuart/*.test.ts).

export interface VolumeCandidate {
  sourceId: string;
  name: string;
  startYear: number | null;
  publisher: string | null;
  countOfIssues: number | null;
  siteUrl: string | null;
}

export interface BookGroup {
  series: string;
  volume: string | null;
  publisher: string | null;
  books: GroupBook[];
}

export interface GroupBook {
  bookId: number;
  number: string | null;
  publishDate: string | null; // YYYY-MM-DD
}

const TITLE_STOP_WORDS = new Set(['the', 'a', 'an']);
const PUBLISHER_STOP_WORDS = new Set([
  'comics', 'comic', 'publishing', 'publications', 'studios', 'studio',
  'entertainment', 'inc', 'llc', 'ltd', 'press', 'group', 'books', 'media',
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** "The Immortal Hulk" and "Immortal Hulk" compare equal; punctuation and case are ignored. */
export function normalizeTitle(title: string): string {
  return words(title).filter((w, i) => !(i === 0 && TITLE_STOP_WORDS.has(w))).join(' ');
}

/** "Marvel Comics" → "marvel", "BOOM! Studios" → "boom", "IDW Publishing" → "idw". */
export function normalizePublisher(publisher: string | null | undefined): string | null {
  if (!publisher) return null;
  const kept = words(publisher).filter((w) => !PUBLISHER_STOP_WORDS.has(w));
  return kept.length ? kept.join(' ') : words(publisher).join(' ') || null;
}

export function publishersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePublisher(a);
  const nb = normalizePublisher(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(`${nb} `) || nb.startsWith(`${na} `);
}

/** Issue numbers compare as text after trimming leading zeros: "001" → "1", "1.MU" stays. */
export function normalizeIssueNumber(number: string | null | undefined): string | null {
  if (number == null) return null;
  const trimmed = String(number).trim().replace(/^#/, '');
  if (!trimmed) return null;
  return trimmed.replace(/^0+(?=\d)/, '').toLowerCase();
}

function numericIssue(number: string | null): number | null {
  const n = normalizeIssueNumber(number);
  if (!n) return null;
  const parsed = Number.parseFloat(n);
  return Number.isFinite(parsed) ? parsed : null;
}

function yearOf(date: string | null): number | null {
  const match = date?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

/** A volume label like "2021" is a start year; anything else isn't used to filter. */
export function volumeYear(volume: string | null): number | null {
  const match = volume?.trim().match(/^(?:vol(?:ume)?\.?\s*)?(\d{4})$/i);
  return match ? Number(match[1]) : null;
}

export function earliestPublishDate(books: readonly GroupBook[]): string | null {
  return books.reduce<string | null>(
    (min, b) => (b.publishDate && (!min || b.publishDate < min) ? b.publishDate : min),
    null
  );
}

export interface CandidateFilterResult {
  candidates: VolumeCandidate[];
  rejected: { sourceId: string; name: string; startYear: number | null; publisher: string | null; reason: string }[];
}

/**
 * Narrow ComicVine volumes down to ones that could hold this group of books,
 * most likely first. Verification against issue dates happens afterwards.
 */
export function filterCandidates(group: BookGroup, all: readonly VolumeCandidate[]): CandidateFilterResult {
  const wantTitle = normalizeTitle(group.series);
  const wantYear = volumeYear(group.volume);
  const firstYear = yearOf(earliestPublishDate(group.books));
  const maxIssue = group.books.reduce<number | null>((max, b) => {
    const n = numericIssue(b.number);
    return n != null && (max == null || n > max) ? n : max;
  }, null);

  const rejected: CandidateFilterResult['rejected'] = [];
  const reject = (c: VolumeCandidate, reason: string) =>
    rejected.push({ sourceId: c.sourceId, name: c.name, startYear: c.startYear, publisher: c.publisher, reason });

  const seen = new Set<string>();
  const candidates: VolumeCandidate[] = [];
  for (const c of all) {
    if (seen.has(c.sourceId)) continue;
    seen.add(c.sourceId);

    if (normalizeTitle(c.name) !== wantTitle) {
      reject(c, 'title differs');
      continue;
    }
    if (group.publisher && !publishersMatch(group.publisher, c.publisher)) {
      reject(c, 'publisher differs');
      continue;
    }
    if (wantYear != null && c.startYear != null && Math.abs(c.startYear - wantYear) > 1) {
      reject(c, `started ${c.startYear}, not ${wantYear}`);
      continue;
    }
    if (firstYear != null && c.startYear != null && c.startYear > firstYear) {
      reject(c, `started ${c.startYear}, after the issue was published (${firstYear})`);
      continue;
    }
    // ComicVine can lag on new issues, so only reject clearly-too-short runs.
    if (maxIssue != null && c.countOfIssues != null && c.countOfIssues > 0 && maxIssue > c.countOfIssues + 3) {
      reject(c, `only ${c.countOfIssues} issues, need #${maxIssue}`);
      continue;
    }
    candidates.push(c);
  }

  // Most recent start year first: with a publish date, the newest run that
  // started on or before it is the likeliest.
  candidates.sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0));
  return { candidates, rejected };
}

/** Days between two YYYY-MM-DD dates (absolute). */
export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** Store and cover dates can differ by a couple of months; allow 75 days. */
export const DATE_TOLERANCE_DAYS = 75;

export function datesAgree(bookDate: string | null, storeDate: string | null, coverDate: string | null): boolean {
  if (!bookDate) return false;
  return [storeDate, coverDate].some((d) => d != null && daysBetween(bookDate, d) <= DATE_TOLERANCE_DAYS);
}

/** The book in a group best suited to verify a candidate volume: dated and numbered. */
export function pickProbeBook(group: BookGroup): GroupBook | null {
  return (
    group.books.find((b) => b.publishDate && normalizeIssueNumber(b.number)) ??
    null
  );
}

/** A series/volume counts as ongoing when its latest issue is under 90 days old (or not out yet). */
export function isOngoing(lastIssueDate: string | null, today: string): boolean | null {
  if (!lastIssueDate) return null;
  return lastIssueDate >= today || daysBetween(lastIssueDate, today) <= 90;
}

export function groupKey(g: { series: string; volume: string | null; publisher: string | null }): string {
  return JSON.stringify([g.series, g.volume ?? '', g.publisher ?? '']);
}

/** Group pending books by the user's own (series, volume, publisher) text. */
export function groupBooks(
  rows: readonly {
    book_id: number;
    series: string;
    volume: string | null;
    publisher: string | null;
    number: string | null;
    publish_date: string | null;
  }[]
): BookGroup[] {
  const groups = new Map<string, BookGroup>();
  for (const row of rows) {
    const key = groupKey(row);
    let group = groups.get(key);
    if (!group) {
      group = { series: row.series, volume: row.volume, publisher: row.publisher, books: [] };
      groups.set(key, group);
    }
    group.books.push({ bookId: row.book_id, number: row.number, publishDate: row.publish_date });
  }
  return [...groups.values()];
}
