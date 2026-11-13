import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullListIssue, PullListSeriesMeta } from '../lib/types';

vi.mock('../lib/api', () => ({
  fetchOpenStuartErrors: vi.fn(),
  fetchPullListIssues: vi.fn(),
  fetchPullListSeriesMeta: vi.fn(),
  reorderPullListSeries: vi.fn(),
  setPullListSeriesFamily: vi.fn(),
  setPullListSeriesStatus: vi.fn(),
  setPullListSeriesTitleArt: vi.fn(),
  fetchBookThumbnail: vi.fn(),
}));

import * as api from '../lib/api';
import { PullListPage } from './PullListPage';

function issue(overrides: Partial<PullListIssue> & { book_id: number }): PullListIssue {
  return {
    publisher: 'Marvel',
    series: 'X-Men',
    volume: '2021',
    number: '1',
    publish_date: null,
    thumbnail: null,
    thumbnail_cached_at: null,
    completed: false,
    ...overrides,
  };
}

const metadata: PullListSeriesMeta[] = [
  {
    series: 'X-Men',
    volume: '2021',
    publisher: 'Marvel',
    family: 'X-Men',
    status: 'read_all',
    sort_order: 10,
    title_art_book_id: null,
    title_art_x: null,
    title_art_y: null,
    title_art_w: null,
    title_art_h: null,
  },
];

beforeEach(() => {
  vi.mocked(api.fetchPullListIssues).mockResolvedValue([
    issue({ book_id: 1, completed: true }),
    // Same book on a second list: counted once.
    issue({ book_id: 1, completed: true }),
    issue({ book_id: 2, number: '2' }),
    issue({ book_id: 3, series: 'Saga', publisher: 'Image', volume: null }),
  ]);
  vi.mocked(api.fetchPullListSeriesMeta).mockResolvedValue(metadata);
  vi.mocked(api.fetchOpenStuartErrors).mockResolvedValue([]);
  vi.mocked(api.setPullListSeriesStatus).mockResolvedValue();
  vi.mocked(api.setPullListSeriesFamily).mockResolvedValue();
  vi.mocked(api.reorderPullListSeries).mockResolvedValue();
});

function rowFor(title: string) {
  return screen.getByRole('button', { name: `Edit title art for ${title}` }).closest('[role="row"]') as HTMLElement;
}

describe('PullListPage', () => {
  it('shows one de-duplicated row per series with issue totals', async () => {
    render(<PullListPage />);

    const xmen = await waitFor(() => rowFor('X-Men (2021)'));
    expect(within(xmen).getByText('Marvel')).toBeInTheDocument();
    expect(within(xmen).getByDisplayValue('X-Men')).toBeInTheDocument();
    expect(within(xmen).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(within(xmen).getByRole('progressbar')).toHaveAttribute('aria-valuemax', '2');
    expect(within(xmen).getByLabelText('Status for X-Men (2021)')).toHaveValue('read_all');

    const saga = rowFor('Saga');
    expect(within(saga).getByLabelText('Status for Saga')).toHaveValue('');
    expect(screen.getByText('2 series · 1 / 3 issues read')).toBeInTheDocument();
  });

  it('saves a status change', async () => {
    const user = userEvent.setup();
    render(<PullListPage />);

    const select = await screen.findByLabelText('Status for Saga');
    await user.selectOptions(select, 'maybe');

    expect(select).toHaveValue('maybe');
    expect(api.setPullListSeriesStatus).toHaveBeenCalledWith(
      expect.objectContaining({ series: 'Saga', volume: '', publisher: 'Image' }),
      'maybe'
    );
  });

  it('saves the family when the field loses focus', async () => {
    const user = userEvent.setup();
    render(<PullListPage />);

    const input = await screen.findByLabelText('Family for Saga');
    await user.type(input, 'Image Universe');
    await user.tab();

    expect(api.setPullListSeriesFamily).toHaveBeenCalledWith(
      expect.objectContaining({ series: 'Saga' }),
      'Image Universe'
    );
  });

  it('persists the full order when a series is moved', async () => {
    const user = userEvent.setup();
    render(<PullListPage />);

    await user.click(await screen.findByRole('button', { name: 'Move Saga up' }));

    expect(api.reorderPullListSeries).toHaveBeenCalledWith([
      expect.objectContaining({ series: 'Saga' }),
      expect.objectContaining({ series: 'X-Men' }),
    ]);
  });

  it('filters by status and disables reordering while filtered', async () => {
    const user = userEvent.setup();
    render(<PullListPage />);

    await user.selectOptions(await screen.findByLabelText('Filter by status'), 'unset');

    expect(screen.queryByRole('button', { name: 'Edit title art for X-Men (2021)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag Saga to reorder' })).toBeDisabled();
  });

  it('shows the run size and ongoing status from a Stuart match', async () => {
    vi.mocked(api.fetchPullListIssues).mockResolvedValue([
      issue({
        book_id: 9,
        series: 'Cable',
        volume: null,
        series_volume: {
          series_volume_id: 1,
          name: 'Cable',
          start_year: 2020,
          publisher: 'Marvel',
          count_of_issues: 12,
          is_ongoing: true,
          site_url: null,
        },
      }),
    ]);
    render(<PullListPage />);

    const cable = await waitFor(() => rowFor('Cable (2020)'));
    expect(within(cable).getByText('of 12')).toBeInTheDocument();
    expect(within(cable).getByText('Ongoing')).toBeInTheDocument();
  });

  it('links to scan failures and lists them', async () => {
    vi.mocked(api.fetchOpenStuartErrors).mockResolvedValue([
      {
        error_id: 1,
        book_id: 3,
        series: 'Buffy Season 9',
        volume: null,
        publisher: 'Dark Horse Comics',
        number: '1',
        adapter: 'comicvine',
        code: 'no_candidates',
        message: 'Found 1 ComicVine volume(s), but none fit.',
        details: { rejected: [] },
        created_at: '2026-11-13T08:00:00Z',
      },
    ]);
    const user = userEvent.setup();
    render(<PullListPage />);

    await user.click(await screen.findByRole('button', { name: '1 recent scans failed. Click for error conditions.' }));
    const dialog = screen.getByRole('dialog', { name: 'Metadata scan failures' });
    expect(within(dialog).getByText('Buffy Season 9 #1')).toBeInTheDocument();
    expect(within(dialog).getByText('no_candidates')).toBeInTheDocument();
  });

  it('holds storylines for future work', async () => {
    const user = userEvent.setup();
    render(<PullListPage />);

    await user.click(await screen.findByRole('tab', { name: 'Storylines' }));
    expect(screen.getByText('Storylines are coming soon.')).toBeInTheDocument();
  });
});
