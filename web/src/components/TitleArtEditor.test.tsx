import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildPullListSeries } from '../lib/pullList';
import type { PullListIssue } from '../lib/types';

vi.mock('../lib/api', () => ({ fetchBookThumbnail: vi.fn() }));

import { TitleArtEditor } from './TitleArtEditor';

function issue(overrides: Partial<PullListIssue> & { book_id: number }): PullListIssue {
  return {
    publisher: 'Marvel',
    series: 'X-Men',
    volume: '2021',
    number: String(overrides.book_id),
    publish_date: null,
    thumbnail: `https://example.com/${overrides.book_id}.jpg`,
    thumbnail_cached_at: null,
    completed: false,
    ...overrides,
  };
}

const [series] = buildPullListSeries([issue({ book_id: 1 }), issue({ book_id: 2 })], []);

function stubRect(el: Element) {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 300, right: 200, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

describe('TitleArtEditor', () => {
  it('saves the chosen cover with the dragged crop', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TitleArtEditor series={series} onSave={onSave} onReset={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Use cover of #2' }));

    const area = screen.getByTestId('title-art-crop-area');
    stubRect(area);
    fireEvent.pointerDown(area, { clientX: 20, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(area, { clientX: 180, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(area, { pointerId: 1 });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [bookId, crop] = onSave.mock.calls[0];
    expect(bookId).toBe(2);
    expect(crop.x).toBeCloseTo(0.1);
    expect(crop.y).toBeCloseTo(0.1);
    expect(crop.w).toBeCloseTo(0.8);
    expect(crop.h).toBeCloseTo(0.2);
  });

  it('only offers "Use default" once a custom title art is saved', () => {
    render(<TitleArtEditor series={series} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Use default' })).toBeDisabled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TitleArtEditor series={series} onSave={vi.fn()} onReset={vi.fn()} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
