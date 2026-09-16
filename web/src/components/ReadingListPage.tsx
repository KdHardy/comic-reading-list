import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  addNote,
  createSectionDivider,
  deleteListEntry,
  deleteNote,
  fetchListDetail,
  fetchLocations,
  revertList,
  setBookCompleted,
  setBookLocation,
  reorderListEntries,
  updateListTitle,
  updateNote,
  updateSectionDivider,
} from '../lib/api';
import { defaultDividerName } from '../lib/divider';
import {
  computeDragReorder,
  computeStepReorder,
  filterVisibleEntries,
  mergeVisibleEntryOrder,
  readHideReadPreference,
  writeHideReadPreference,
} from '../lib/listOrder';
import { snapshotFromEntries } from '../lib/listSnapshot';
import { calculateReadingStats } from '../lib/readingStats';
import { isBookEntry, type Book, type ListEntry, type ListSnapshot, type LocationOption } from '../lib/types';
import { EditableTitle } from './EditableTitle';
import { HideReadToggle } from './HideReadToggle';
import { BookRow } from './BookRow';
import { DividerInsertZone } from './DividerInsertZone';
import { DividerRow } from './DividerRow';
import { ReadingStats } from './ReadingStats';

interface Props {
  listId: number;
  onListRenamed?: () => void;
}

export function ReadingListPage({ listId, onListRenamed }: Props) {
  const [listName, setListName] = useState('');
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [snapshot, setSnapshot] = useState<ListSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reverting, setReverting] = useState(false);
  const [hideRead, setHideRead] = useState(() => readHideReadPreference(listId));

  useEffect(() => {
    setHideRead(readHideReadPreference(listId));
  }, [listId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function load(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [{ list, entries: fetchedEntries }, locs] = await Promise.all([fetchListDetail(listId), fetchLocations()]);
      setListName(list.list_name);
      setEntries(fetchedEntries);
      setLocations(locs);
      if (!silent) {
        setSnapshot(snapshotFromEntries(list.list_name, fetchedEntries));
      }
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Failed to load reading list.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  // Refresh when the tab becomes visible (e.g. after adding comics in the extension)
  // and poll quietly while the tab is open so changes appear without a manual reload.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        load({ silent: true });
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        load({ silent: true });
      }
    }, 20000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const visibleEntries = useMemo(() => filterVisibleEntries(entries, hideRead), [entries, hideRead]);
  const readingStats = useMemo(() => calculateReadingStats(entries), [entries]);

  const visibleEntryIds = useMemo(
    () => visibleEntries.map((entry) => entry.entry_id),
    [visibleEntries]
  );
  const orderingDisabled = hideRead;

  function handleHideReadChange(checked: boolean) {
    setHideRead(checked);
    writeHideReadPreference(listId, checked);
  }

  async function persistOrder(reorderedIds: number[]) {
    const mergedIds = mergeVisibleEntryOrder(entries, reorderedIds, hideRead);
    setEntries((prev) => {
      const byId = new Map(prev.map((entry) => [entry.entry_id, entry]));
      return mergedIds.map((id, idx) => ({ ...byId.get(id)!, read_order: (idx + 1) * 10 }));
    });
    try {
      await reorderListEntries(listId, mergedIds);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to reorder.');
      load();
    }
  }

  async function handleTitleSave(newTitle: string) {
    await updateListTitle(listId, newTitle);
    setListName(newTitle);
    onListRenamed?.();
  }

  async function handleToggleComplete(bookId: number, completed: boolean) {
    setEntries((prev) =>
      prev.map((entry) =>
        isBookEntry(entry) && entry.book_id === bookId
          ? {
              ...entry,
              book: {
                ...entry.book,
                completed,
                completed_date: completed ? new Date().toISOString() : null,
              },
            }
          : entry
      )
    );
    try {
      await setBookCompleted(bookId, completed);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update.');
      load();
    }
  }

  async function handleLocationChange(bookId: number, slot: 1 | 2 | 3, locationId: number | null) {
    const field = (['location1_id', 'location2_id', 'location3_id'] as const)[slot - 1];
    setEntries((prev) =>
      prev.map((entry) =>
        isBookEntry(entry) && entry.book_id === bookId
          ? { ...entry, book: { ...entry.book, [field]: locationId } }
          : entry
      )
    );
    try {
      await setBookLocation(bookId, slot, locationId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update location.');
      load();
    }
  }

  function handleMove(entryId: number, direction: 'up' | 'down') {
    if (orderingDisabled) return;
    const reordered = computeStepReorder(visibleEntryIds, entryId, direction);
    if (!reordered) return;
    persistOrder(reordered);
  }

  function handleDragEnd(event: DragEndEvent) {
    if (orderingDisabled) return;
    const { active, over } = event;
    if (!over) return;
    const reordered = computeDragReorder(visibleEntryIds, Number(active.id), Number(over.id));
    if (!reordered) return;
    persistOrder(reordered);
  }

  async function handleRemove(entryId: number, title: string) {
    if (!window.confirm(`Remove "${title}" from this list?`)) return;
    const previousEntries = entries;
    setEntries((prev) => prev.filter((entry) => entry.entry_id !== entryId));
    try {
      await deleteListEntry(listId, entryId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove.');
      setEntries(previousEntries);
    }
  }

  async function handleInsertDivider(beforeEntryId: number, belowBook: Book) {
    if (orderingDisabled) return;
    const name = defaultDividerName(belowBook);
    try {
      await createSectionDivider(listId, name, beforeEntryId);
      await load({ silent: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add divider.');
    }
  }

  async function handleUpdateDivider(entryId: number, dividerName: string) {
    await updateSectionDivider(entryId, dividerName);
    setEntries((prev) =>
      prev.map((entry) =>
        entry.entry_id === entryId && entry.entry_type === 'divider'
          ? { ...entry, divider_name: dividerName }
          : entry
      )
    );
  }

  async function handleAddNote(bookId: number, text: string) {
    try {
      const note = await addNote(bookId, text);
      setEntries((prev) =>
        prev.map((entry) =>
          isBookEntry(entry) && entry.book_id === bookId
            ? { ...entry, book: { ...entry.book, notes: [...entry.book.notes, note] } }
            : entry
        )
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add note.');
    }
  }

  async function handleUpdateNote(noteId: number, text: string) {
    const previousEntries = entries;
    setEntries((prev) =>
      prev.map((entry) =>
        isBookEntry(entry)
          ? {
              ...entry,
              book: {
                ...entry.book,
                notes: entry.book.notes.map((note) =>
                  note.note_id === noteId ? { ...note, note_text: text } : note
                ),
              },
            }
          : entry
      )
    );
    try {
      await updateNote(noteId, text);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update note.');
      setEntries(previousEntries);
    }
  }

  async function handleDeleteNote(noteId: number) {
    const previousEntries = entries;
    setEntries((prev) =>
      prev.map((entry) =>
        isBookEntry(entry)
          ? {
              ...entry,
              book: {
                ...entry.book,
                notes: entry.book.notes.filter((note) => note.note_id !== noteId),
              },
            }
          : entry
      )
    );
    try {
      await deleteNote(noteId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete note.');
      setEntries(previousEntries);
    }
  }

  function handleThumbnailCached(bookId: number) {
    const cachedAt = new Date().toISOString();
    setEntries((prev) =>
      prev.map((entry) =>
        isBookEntry(entry) && entry.book_id === bookId
          ? { ...entry, book: { ...entry.book, thumbnail_cached_at: cachedAt } }
          : entry
      )
    );
  }

  async function handleRevert() {
    if (!snapshot) return;
    if (!window.confirm('Revert all changes made since this page was loaded?')) return;
    setReverting(true);
    try {
      await revertList(listId, snapshot);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to revert.');
    } finally {
      setReverting(false);
    }
  }

  if (loading) return <div className="app-status">Loading list…</div>;
  if (error) return <div className="app-status app-status-error">{error}</div>;

  return (
    <div className="reading-list-page">
      <div className="list-toolbar">
        <div className="list-toolbar-title">
          <EditableTitle title={listName} onSave={handleTitleSave} />
        </div>
        <HideReadToggle checked={hideRead} onChange={handleHideReadChange} />
      </div>

      <ReadingStats stats={readingStats} />

      {orderingDisabled && (
        <span className="ordering-disabled-note">Show read comics to reorder or insert dividers.</span>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleEntryIds} strategy={verticalListSortingStrategy}>
          <div className="book-list">
            {visibleEntries.map((entry, idx) => (
              <Fragment key={entry.entry_id}>
                {entry.entry_type === 'book' && (
                  <DividerInsertZone
                    label={`Insert section divider above ${entry.book.series}`}
                    disabled={orderingDisabled}
                    disabledReason="Show read comics to insert dividers"
                    onInsert={() => void handleInsertDivider(entry.entry_id, entry.book)}
                  />
                )}
                {entry.entry_type === 'book' ? (
                  <BookRow
                    key={entry.entry_id}
                    entryId={entry.entry_id}
                    book={entry.book}
                    locations={locations}
                    isFirst={idx === 0}
                    isLast={idx === visibleEntries.length - 1}
                    orderingDisabled={orderingDisabled}
                    onToggleComplete={handleToggleComplete}
                    onMove={handleMove}
                    onLocationChange={handleLocationChange}
                    onRemove={handleRemove}
                    onAddNote={handleAddNote}
                    onUpdateNote={handleUpdateNote}
                    onDeleteNote={handleDeleteNote}
                    onThumbnailCached={handleThumbnailCached}
                  />
                ) : (
                  <DividerRow
                    key={entry.entry_id}
                    entry={entry}
                    isFirst={idx === 0}
                    isLast={idx === visibleEntries.length - 1}
                    orderingDisabled={orderingDisabled}
                    onMove={handleMove}
                    onSave={handleUpdateDivider}
                    onDelete={handleRemove}
                  />
                )}
              </Fragment>
            ))}
            {entries.length === 0 && (
              <p className="app-status">No comics in this list yet — add some from the browser extension.</p>
            )}
            {entries.length > 0 && hideRead && visibleEntries.length === 0 && (
              <p className="app-status">All comics in this list are marked read.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <button type="button" className="revert-button" onClick={handleRevert} disabled={reverting}>
        {reverting ? 'Reverting…' : 'Revert'}
      </button>
    </div>
  );
}
