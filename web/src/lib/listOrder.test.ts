import { describe, expect, it } from 'vitest';
import {
  computeDragReorder,
  computeStepReorder,
  filterVisibleEntries,
  mergeVisibleEntryOrder,
  resolveDividerInsertBeforeEntryId,
} from './listOrder';
import type { Book, ListEntry } from './types';

function book(entryId: number, completed: boolean): ListEntry {
  return {
    entry_id: entryId,
    list_id: 1,
    entry_type: 'book',
    book_id: entryId * 100,
    divider_name: null,
    read_order: entryId * 10,
    book: { completed } as Book,
  };
}

function divider(entryId: number, name = `Section ${entryId}`): ListEntry {
  return {
    entry_id: entryId,
    list_id: 1,
    entry_type: 'divider',
    book_id: null,
    divider_name: name,
    read_order: entryId * 10,
    book: null,
  };
}

describe('mergeVisibleEntryOrder', () => {
  it('uses the complete supplied entry order when nothing is hidden', () => {
    expect(mergeVisibleEntryOrder([book(1, false), divider(2), book(3, false)], [3, 2, 1], false)).toEqual([
      3, 2, 1,
    ]);
  });

  it('places a moved divider immediately before the visible unread it precedes, skipping hidden reads', () => {
    // Full: unread A, read B, DIV, unread C. Visible: A, DIV, C.
    // Drag DIV above A in the UI → DIV must sit immediately before A (not before B).
    const entries = [book(1, false), book(2, true), divider(3), book(4, false)];
    const visibleReorder = computeDragReorder([1, 3, 4], 3, 1)!;

    expect(visibleReorder).toEqual([3, 1, 4]);
    expect(mergeVisibleEntryOrder(entries, visibleReorder, true)).toEqual([3, 1, 2, 4]);
  });

  it('keeps hidden reads with the preceding visible book when a divider is stepped down', () => {
    // Full: A, B_read, DIV, C. Step DIV down past C in the visible list.
    const entries = [book(1, false), book(2, true), divider(3), book(4, false)];
    const visibleReorder = computeStepReorder([1, 3, 4], 3, 'down')!;

    expect(visibleReorder).toEqual([1, 4, 3]);
    expect(mergeVisibleEntryOrder(entries, visibleReorder, true)).toEqual([1, 2, 4, 3]);
  });

  it('preserves hidden dividers and reads relative to their anchoring visible book', () => {
    // A unread, DIV2 (hidden: all-read below until DIV4), B read, DIV4 (hidden), C unread.
    const entries = [book(1, false), divider(2), book(3, true), divider(4), book(5, false)];
    expect(filterVisibleEntries(entries, true).map((e) => e.entry_id)).toEqual([1, 5]);

    expect(mergeVisibleEntryOrder(entries, [5, 1], true)).toEqual([5, 1, 2, 3, 4]);
  });

  it('leaves leading hidden reads ahead of the first visible entry after a divider move', () => {
    const entries = [book(1, true), book(2, false), divider(3), book(4, false)];
    // Visible: 2, 3, 4. Move DIV before first visible unread (2).
    const visibleReorder = [3, 2, 4];

    expect(mergeVisibleEntryOrder(entries, visibleReorder, true)).toEqual([1, 3, 2, 4]);
  });
});

describe('resolveDividerInsertBeforeEntryId — hide-read insert placement', () => {
  it('maps the visible unread comic as the full-list before-target', () => {
    // Hover-insert above visible unread C while B (read) is hidden between A and C:
    // passing C's entry_id makes create_section_divider land immediately before C.
    const visibleUnreadEntryId = 4;
    expect(resolveDividerInsertBeforeEntryId(visibleUnreadEntryId)).toBe(4);
  });

  it('keeps insert placement stable when hidden reads sit above the visible target', () => {
    const entries = [book(1, false), book(2, true), book(3, true), book(4, false)];
    const visible = filterVisibleEntries(entries, true);
    expect(visible.map((e) => e.entry_id)).toEqual([1, 4]);

    // Insert above the second visible unread — before-id is that unread's entry_id,
    // so the new divider precedes it (and stays after the hidden reads 2 and 3).
    const beforeId = resolveDividerInsertBeforeEntryId(visible[1]!.entry_id);
    expect(beforeId).toBe(4);

    // Simulate post-insert full order the RPC would produce for before_entry_id=4.
    const simulated = [1, 2, 3, 99, 4];
    expect(simulated.indexOf(99)).toBe(simulated.indexOf(4) - 1);
    expect(simulated.indexOf(99)).toBeGreaterThan(simulated.indexOf(2));
  });
});

describe('filterVisibleEntries', () => {
  it('returns every entry unchanged when hide-read is off, even around all-read sections', () => {
    const entries = [book(1, true), divider(2), book(3, true), divider(4), book(5, false)];
    expect(filterVisibleEntries(entries, false)).toEqual(entries);
  });

  it('shows a divider only when it has a visible unread comic on both sides', () => {
    const entries = [book(1, false), divider(2), book(3, false)];
    const visible = filterVisibleEntries(entries, true);
    expect(visible.map((e) => e.entry_id)).toEqual([1, 2, 3]);
  });

  it('hides a divider whose bounded section above is entirely read', () => {
    // Divider 2 has nothing but a read book above it — hidden.
    const entries = [book(1, true), divider(2), book(3, false)];
    expect(filterVisibleEntries(entries, true).map((e) => e.entry_id)).toEqual([3]);
  });

  it('hides a divider whose bounded section below is entirely read', () => {
    const entries = [book(1, false), divider(2), book(3, true)];
    expect(filterVisibleEntries(entries, true).map((e) => e.entry_id)).toEqual([1]);
  });

  it('hides a divider at the very start of the list (nothing unread above it)', () => {
    const entries = [divider(1), book(2, false), book(3, false)];
    expect(filterVisibleEntries(entries, true).map((e) => e.entry_id)).toEqual([2, 3]);
  });

  it('hides a divider at the very end of the list (nothing unread below it)', () => {
    const entries = [book(1, false), book(2, false), divider(3)];
    expect(filterVisibleEntries(entries, true).map((e) => e.entry_id)).toEqual([1, 2]);
  });

  it('hides two back-to-back dividers with nothing unread between them', () => {
    const entries = [book(1, false), divider(2), divider(3), book(4, false)];
    expect(filterVisibleEntries(entries, true).map((e) => e.entry_id)).toEqual([1, 4]);
  });

  it('hides two back-to-back dividers even when a fully-read book sits between them', () => {
    const entries = [book(1, false), divider(2), book(3, true), divider(4), book(5, false)];
    expect(filterVisibleEntries(entries, true).map((e) => e.entry_id)).toEqual([1, 5]);
  });

  it('keeps a divider visible when both bounded sections have at least one unread comic among other read ones', () => {
    const entries = [
      book(1, true),
      book(2, false),
      divider(3),
      book(4, true),
      book(5, false),
      book(6, true),
    ];
    expect(filterVisibleEntries(entries, true).map((e) => e.entry_id)).toEqual([2, 3, 5]);
  });

  it('hides every divider in an all-read list, leaving no comics or dividers visible', () => {
    const entries = [book(1, true), divider(2), book(3, true)];
    expect(filterVisibleEntries(entries, true)).toEqual([]);
  });
});

describe('computeDragReorder', () => {
  it('moves the active entry to the position of the drop target', () => {
    expect(computeDragReorder([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
  });

  it('returns null for a drop on itself (no-op drag)', () => {
    expect(computeDragReorder([1, 2, 3], 2, 2)).toBeNull();
  });

  it('returns null when either id is not present (e.g. dropped outside the list)', () => {
    expect(computeDragReorder([1, 2, 3], 9, 2)).toBeNull();
    expect(computeDragReorder([1, 2, 3], 1, 9)).toBeNull();
  });
});

describe('computeStepReorder', () => {
  it('swaps the entry one position up', () => {
    expect(computeStepReorder([1, 2, 3], 2, 'up')).toEqual([2, 1, 3]);
  });

  it('swaps the entry one position down', () => {
    expect(computeStepReorder([1, 2, 3], 2, 'down')).toEqual([1, 3, 2]);
  });

  it('returns null when already at the top and moving up', () => {
    expect(computeStepReorder([1, 2, 3], 1, 'up')).toBeNull();
  });

  it('returns null when already at the bottom and moving down', () => {
    expect(computeStepReorder([1, 2, 3], 3, 'down')).toBeNull();
  });

  it('returns null for an unknown entry id', () => {
    expect(computeStepReorder([1, 2, 3], 99, 'up')).toBeNull();
  });
});
