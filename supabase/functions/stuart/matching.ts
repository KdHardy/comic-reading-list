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
  /** A known alternative name for the series (see stuart_series_alias). */
  alias?: SeriesAlias | null;
}

/** "Buffy Classic" is what the reading lists call "Buffy the Vampire Slayer" (1998, Dark Horse). */
export interface SeriesAlias {
  alias: string;
  title: string;
  startYear: number | null;
  publisher: string | null;
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
 * A looser title match for shorthand names, used only when no exact title fits
 * and always verified against an issue date:
 *  - the candidate is "<Franchise>: <wanted>" ("Angel: A Hole in the World"), or
 *  - every word of `wanted` appears in `candidate`, in order, starting with the
 *    same first word ("Buffy Season 9" ~ "Buffy the Vampire Slayer Season Nine").
 */
export function titleLooselyMatches(wanted: string, candidate: string): boolean {
  const colon = candidate.indexOf(':');
  if (colon > 0 && normalizeTitle(candidate.slice(colon + 1)) === normalizeTitle(wanted)) return true;

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
  const title = searchTitle(group);
  const wantTitle = normalizeTitle(title);
  const wantYear = group.alias?.startYear ?? volumeYear(group.volume);
  const wantPublisher = group.alias?.publisher ?? group.publisher;
  const firstYear = yearOf(earliestPublishDate(group.books));

  const rejected: CandidateFilterResult['rejected'] = [];
  const reject = (c: VolumeCandidate, reason: string) =>
    rejected.push({ sourceId: c.sourceId, name: c.name, startYear: c.startYear, publisher: c.publisher, reason });

  const seen = new Set<string>();
  const unique = all.filter((c) => !seen.has(c.sourceId) && seen.add(c.sourceId));
  const exact = unique.filter((c) => normalizeTitle(c.name) === wantTitle);
  const loose = exact.length === 0;
  const titled = loose ? unique.filter((c) => titleLooselyMatches(title, c.name)) : exact;
  const titledIds = new Set(titled.map((c) => c.sourceId));
  for (const c of unique) if (!titledIds.has(c.sourceId)) reject(c, 'title differs');

  const candidates: VolumeCandidate[] = [];
  for (const c of titled) {
    if (wantPublisher && !publishersMatch(wantPublisher, c.publisher)) {
      reject(c, 'publisher differs');
      continue;
    }
    if (wantYear != null && c.startYear != null && Math.abs(c.startYear - wantYear) > 1) {
      reject(c, `started ${c.startYear}, not ${wantYear}`);
      continue;
    }
    if (!group.alias?.startYear && firstYear != null && c.startYear != null && c.startYear > firstYear) {
      reject(c, `started ${c.startYear}, after the issue was published (${firstYear})`);
      continue;
    }
    // Issue counts aren't used to rule runs out: legacy numbering (Action
    // Comics #1031 in a 148-issue run) breaks that. The issue-date check decides.
    candidates.push(c);
  }

  // Most recent start year first: with a publish date, the newest run that
  // started on or before it is the likeliest.
  // On a tie, the plainer title first ("Buffy … Season Nine" before "Buffy … Season Nine: Guarded").
  candidates.sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0) || a.name.length - b.name.length);
  // Report the informative rejections (publisher, year) before "title differs".
  rejected.sort((a, b) => Number(a.reason === 'title differs') - Number(b.reason === 'title differs'));
  return { candidates, loose: loose && candidates.length > 0, rejected };
}

/** The title to look a group up by: its alias when it has one. */
export function searchTitle(group: BookGroup): string {
  return group.alias?.title ?? group.series;
}

/** The alias for a series name, if any (case, punctuation and spelled-out numbers ignored). */
export function findAlias(series: string, aliases: readonly SeriesAlias[]): SeriesAlias | null {
  const want = normalizeTitle(series);
  return aliases.find((a) => normalizeTitle(a.alias) === want) ?? null;
}

/**
 * Backup stories and extras inside other comics ("Buffy Season 9 short",
 * "Angel extra") aren't issues of a series, so Stuart skips them.
 */
export function skippedFormat(series: string): 'short' | 'extra' | null {
  const match = series.trim().match(/\s(short|extra)$/i);
  return match ? (match[1].toLowerCase() as 'short' | 'extra') : null;
}

/**
 * A release-date window to look an issue up in: `days` either side of the
 * reading-list date (default about a quarter), kept inside the same year.
 */
export function issueSearchWindow(date: string, days = DATE_WINDOW_DAYS): { start: string; end: string } {
  const year = date.slice(0, 4);
  const start = shiftDays(date, -days);
  const end = shiftDays(date, days);
  return {
    start: start.slice(0, 4) === year ? start : `${year}-01-01`,
    end: end.slice(0, 4) === year ? end : `${year}-12-31`,
  };
}

/** Days between two YYYY-MM-DD dates (absolute). */
export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** How far a release date may be from the reading-list date: about a quarter. */
export const DATE_WINDOW_DAYS = 92;
/** Many publishers' cover dates run about two months after the release (store) date. */
export const COVER_DATE_LEAD_DAYS = 60;

export interface DateMatch {
  /** Same year and within about a quarter: a solid match. */
  solid: boolean;
  /** Days between the reading-list date and the (estimated) release date. */
  days: number | null;
  basis: 'store' | 'cover' | 'cover-2mo' | null;
  releaseDate: string | null;
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Compare a comic's reading-list date with a database issue's release date.
 * The store date is used when there is one. Otherwise the cover date is tried
 * both as-is and moved back two months, since publishers differ (some print
 * the release month, others a month or two ahead); the closer one counts.
 * A solid match is in the same year and within about a quarter.
 */
export function compareDates(bookDate: string | null, storeDate: string | null, coverDate: string | null): DateMatch {
  const options: { basis: DateMatch['basis']; date: string }[] = storeDate
    ? [{ basis: 'store', date: storeDate }]
    : coverDate
      ? [
          { basis: 'cover', date: coverDate },
          { basis: 'cover-2mo', date: shiftDays(coverDate, -COVER_DATE_LEAD_DAYS) },
        ]
      : [];
  if (options.length === 0) return { solid: false, days: null, basis: null, releaseDate: null };
  if (!bookDate) return { solid: false, days: null, basis: options[0].basis, releaseDate: options[0].date };

  const scored = options.map((o) => {
    const days = daysBetween(bookDate, o.date);
    return { ...o, days, solid: yearOf(bookDate) === yearOf(o.date) && days <= DATE_WINDOW_DAYS };
  });
  // Prefer a solid reading, then the closest.
  scored.sort((a, b) => Number(b.solid) - Number(a.solid) || a.days - b.days);
  const best = scored[0];
  return { solid: best.solid, days: best.days, basis: best.basis, releaseDate: best.date };
}

/** The book in a group used to verify candidate volumes: the earliest dated, numbered one. */
export function pickProbeBook(group: BookGroup): GroupBook | null {
  return (
    group.books
      .filter((b) => b.publishDate && normalizeIssueNumber(b.number))
      .sort((a, b) => a.publishDate!.localeCompare(b.publishDate!))[0] ?? null
  );
}

/**
 * The book to look an issue up by: the dated one with the highest issue
 * number, since high numbers have far fewer namesakes in a given month.
 */
export function pickLookupBook(group: BookGroup): GroupBook | null {
  const dated = group.books.filter((b) => b.publishDate && normalizeIssueNumber(b.number));
  const numeric = (b: GroupBook) => Number.parseFloat(normalizeIssueNumber(b.number)!);
  return dated.sort((a, b) => (numeric(b) || 0) - (numeric(a) || 0))[0] ?? null;
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
