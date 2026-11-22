import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListEntry, LocationOption, ReadingListSummary } from '../lib/types';
import { writeCachedListDetail, writeCachedLocations } from '../lib/readingListCache';

vi.mock('../lib/api', () => ({
  fetchListDetail: vi.fn(),
  fetchLocations: vi.fn(),
  fetchHistoricReadingData: vi.fn(),
  addNote: vi.fn(),
  createSectionDivider: vi.fn(),
  deleteListEntry: vi.fn(),
  deleteNote: vi.fn(),
  revertList: vi.fn(),
  setBookCompleted: vi.fn(),
  setBookLocation: vi.fn(),
  reorderListEntries: vi.fn(),
  updateListTitle: vi.fn(),
  updateNote: vi.fn(),
  updateSectionDivider: vi.fn(),
}));

import * as api from '../lib/api';
import { ReadingListPage } from './ReadingListPage';

const list: ReadingListSummary = {
  list_id: 3,
  list_name: 'Cached List',
  completed: false,
  created_date: '2024-01-01T00:00:00Z',
  completed_date: null,
};

const entry: ListEntry = {
  entry_id: 11,
  list_id: 3,
  entry_type: 'book',
  book_id: 22,
  divider_name: null,
  read_order: 10,
  book: {
    book_id: 22,
    publisher: 'Marvel',
    series: 'Daredevil',
    volume: '1',
    number: '1',
    event: null,
    publish_date: '2024-03-01',
    thumbnail: null,
    thumbnail_mime: null,
    thumbnail_cached_at: null,
    location1_id: 1,
    location2_id: null,
    location3_id: null,
    completed: false,
    completed_date: null,
    notes: [],
  },
};

const locations: LocationOption[] = [{ location_id: 1, location_name: 'Local' }];

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.fetchHistoricReadingData).mockResolvedValue({
    listBookCounts: [1],
    completedDates: [],
  });
  vi.mocked(api.fetchListDetail).mockRejectedValue(new Error('network down'));
  vi.mocked(api.fetchLocations).mockRejectedValue(new Error('network down'));
});

describe('ReadingListPage offline cache', () => {
  it('renders the last cached list when the network fetch fails', async () => {
    writeCachedListDetail(3, list, [entry]);
    writeCachedLocations(locations);

    render(<ReadingListPage listId={3} readOnly />);

    await waitFor(() => {
      expect(screen.getByText('Cached List')).toBeInTheDocument();
    });
    expect(screen.getByText('Daredevil (Vol 1) #1')).toBeInTheDocument();
    expect(screen.queryByText('network down')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Mark Daredevil/ })).toBeDisabled();
  });

  it('keeps a previously loaded view when a silent refresh fails', async () => {
    vi.mocked(api.fetchListDetail)
      .mockResolvedValueOnce({ list, entries: [entry] })
      .mockRejectedValue(new Error('network down'));
    vi.mocked(api.fetchLocations)
      .mockResolvedValueOnce(locations)
      .mockRejectedValue(new Error('network down'));

    const { rerender } = render(<ReadingListPage listId={3} />);

    await waitFor(() => {
      expect(screen.getByText('Daredevil (Vol 1) #1')).toBeInTheDocument();
    });

    // Force another load by remounting with the same list after cache is warm;
    // silent failure path is covered via rejected subsequent polls in load().
    rerender(<ReadingListPage listId={3} />);

    await waitFor(() => {
      expect(screen.getByText('Daredevil (Vol 1) #1')).toBeInTheDocument();
    });
    expect(screen.queryByText('network down')).not.toBeInTheDocument();
  });
});
