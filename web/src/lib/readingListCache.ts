import type { ListEntry, LocationOption, ReadingListSummary } from './types';

const LISTS_KEY = 'comic-reading-list:cachedLists';
const LOCATIONS_KEY = 'comic-reading-list:cachedLocations';
const DETAIL_KEY_PREFIX = 'comic-reading-list:cachedListDetail:';

export interface CachedListsPayload {
  savedAt: string;
  lists: ReadingListSummary[];
}

export interface CachedLocationsPayload {
  savedAt: string;
  locations: LocationOption[];
}

export interface CachedListDetailPayload {
  savedAt: string;
  list: ReadingListSummary;
  entries: ListEntry[];
}

function detailKey(listId: number): string {
  return `${DETAIL_KEY_PREFIX}${listId}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private-mode storage — ignore; online path still works.
  }
}

export function writeCachedLists(lists: ReadingListSummary[]): void {
  const payload: CachedListsPayload = { savedAt: new Date().toISOString(), lists };
  writeJson(LISTS_KEY, payload);
}

export function readCachedLists(): ReadingListSummary[] | null {
  const payload = readJson<CachedListsPayload>(LISTS_KEY);
  if (!payload || !Array.isArray(payload.lists)) return null;
  return payload.lists;
}

export function writeCachedLocations(locations: LocationOption[]): void {
  const payload: CachedLocationsPayload = { savedAt: new Date().toISOString(), locations };
  writeJson(LOCATIONS_KEY, payload);
}

export function readCachedLocations(): LocationOption[] | null {
  const payload = readJson<CachedLocationsPayload>(LOCATIONS_KEY);
  if (!payload || !Array.isArray(payload.locations)) return null;
  return payload.locations;
}

export function writeCachedListDetail(
  listId: number,
  list: ReadingListSummary,
  entries: ListEntry[]
): void {
  const payload: CachedListDetailPayload = {
    savedAt: new Date().toISOString(),
    list,
    entries,
  };
  writeJson(detailKey(listId), payload);
}

export function readCachedListDetail(listId: number): CachedListDetailPayload | null {
  const payload = readJson<CachedListDetailPayload>(detailKey(listId));
  if (!payload || !payload.list || !Array.isArray(payload.entries)) return null;
  if (payload.list.list_id !== listId) return null;
  return payload;
}
