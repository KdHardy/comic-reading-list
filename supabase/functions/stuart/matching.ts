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
const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20',
};
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

function titleWords(title: string): string[] {
  return words(title)
    .filter((w, i) => !(i === 0 && TITLE_STOP_WORDS.has(w)))
    .map((w) => NUMBER_WORDS[w] ?? w);
}

/**
 * "The Immortal Hulk" = "Immortal Hulk" and "Angel Season Eleven" = "Angel Season 11":
 * punctuation, case, a leading article and spelled-out numbers are ignored.
 */
export function normalizeTitle(title: string): string {
  return titleWords(title).join(' ');
}

/**
 * A looser title match for shorthand names: every word of `wanted` appears in
 * `candidate`, in order, starting with the same first word. "Buffy Season 9"
 * loosely matches "Buffy the Vampire Slayer Season Nine". Only used when no
 * exact title fits, and always verified against an issue date.
 */
export function titleLooselyMatches(wanted: string, candidate: string): boolean {
  const want = titleWords(wanted);
  const have = titleWords(candidate);
  if (want.length === 0 || have[0] !== want[0]) return false;
  let i = 0;
  for (const word of have) {
    if (word === want[i]) i += 1;
    if (i === want.length) return true;
  }
  return false;
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
  /** True when no exact title fit and the candidates are loose title matches. */
  loose: boolean;
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
  const unique = all.filter((c) => !seen.has(c.sourceId) && seen.add(c.sourceId));
  const exact = unique.filter((c) => normalizeTitle(c.name) === wantTitle);
  const loose = exact.length === 0;
  const titled = loose ? unique.filter((c) => titleLooselyMatches(group.series, c.name)) : exact;
  const titledIds = new Set(titled.map((c) => c.sourceId));
  for (const c of unique) if (!titledIds.has(c.sourceId)) reject(c, 'title differs');

  const candidates: VolumeCandidate[] = [];
  for (const c of titled) {
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
  // On a tie, the plainer title first ("Buffy … Season Nine" before "Buffy … Season Nine: Guarded").
  candidates.sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0) || a.name.length - b.name.length);
  return { candidates, loose: loose && candidates.length > 0, rejected };
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
