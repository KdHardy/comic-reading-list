import { beforeEach, describe, expect, it } from 'vitest';
import {
  readCachedListDetail,
  readCachedLists,
  readCachedLocations,
  writeCachedListDetail,
  writeCachedLists,
  writeCachedLocations,
} from './readingListCache';
import type { ListEntry, LocationOption, ReadingListSummary } from './types';

const sampleList: ReadingListSummary = {
  list_id: 7,
  list_name: 'Trial of Destinies',
  completed: false,
  created_date: '2024-01-01T00:00:00Z',
  completed_date: null,
};

const sampleEntry: ListEntry = {
  entry_id: 1,
  list_id: 7,
  entry_type: 'book',
  book_id: 100,
  divider_name: null,
  read_order: 10,
  book: {
    book_id: 100,
    publisher: 'Marvel',
    series: 'X-Men',
    volume: '1',
    number: '1',
    event: null,
    publish_date: '2024-02-01',
    thumbnail: null,
    thumbnail_mime: null,
    thumbnail_cached_at: null,
    location1_id: null,
    location2_id: null,
    location3_id: null,
    completed: false,
    completed_date: null,
    notes: [],
  },
};

const sampleLocations: LocationOption[] = [
  { location_id: 1, location_name: 'Local' },
  { location_id: 2, location_name: 'Marvel Unlimited' },
];

describe('readingListCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips reading list summaries', () => {
    expect(readCachedLists()).toBeNull();
    writeCachedLists([sampleList]);
    expect(readCachedLists()).toEqual([sampleList]);
  });

  it('round-trips locations', () => {
    expect(readCachedLocations()).toBeNull();
    writeCachedLocations(sampleLocations);
    expect(readCachedLocations()).toEqual(sampleLocations);
  });

  it('round-trips list detail keyed by list id', () => {
    expect(readCachedListDetail(7)).toBeNull();
    writeCachedListDetail(7, sampleList, [sampleEntry]);
    const cached = readCachedListDetail(7);
    expect(cached?.list).toEqual(sampleList);
    expect(cached?.entries).toEqual([sampleEntry]);
    expect(readCachedListDetail(99)).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    localStorage.setItem('comic-reading-list:cachedLists', '{not-json');
    expect(readCachedLists()).toBeNull();
  });
});
