import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
  fetchHistoricReadingData,
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
  resolveDividerInsertBeforeEntryId,
  writeHideReadPreference,
} from '../lib/listOrder';
import { snapshotFromEntries } from '../lib/listSnapshot';
import {
  readCachedListDetail,
  readCachedLocations,
  writeCachedListDetail,
  writeCachedLocations,
} from '../lib/readingListCache';
import { calculateCurrentDateGap } from '../lib/currentDateGap';
import { calculateHistoricReadingStats, type HistoricReadingStats } from '../lib/historicReadingStats';
import { calculateListReadingStats, calculateReadingActivity, type ReadingActivity } from '../lib/readingStats';
import { isBookEntry, type Book, type ListEntry, type ListSnapshot, type LocationOption } from '../lib/types';
import { EditableTitle } from './EditableTitle';
import { HideReadToggle } from './HideReadToggle';
import { BookRow } from './BookRow';
import { DividerInsertZone } from './DividerInsertZone';
import { DividerRow } from './DividerRow';
import { ReadingStats } from './ReadingStats';

interface Props {
  listId: number;
  /** When true, block mutations (offline / read-only mode). */
  readOnly?: boolean;
  onListRenamed?: () => void;
  /** Notify the shell when this page is serving cached data after a failed fetch. */
  onServingFromCacheChange?: (fromCache: boolean) => void;
}

function requireOnline(readOnly: boolean): boolean {
  if (!readOnly) return true;
  alert('This action requires a network connection.');
  return false;
}

export function ReadingListPage({ listId, readOnly = false, onListRenamed, onServingFromCacheChange }: Props) {
  const [listName, setListName] = useState('');
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [snapshot, setSnapshot] = useState<ListSnapshot | null>(null);
  const [historicStats, setHistoricStats] = useState<HistoricReadingStats | null>(null);
  const [readingActivity, setReadingActivity] = useState<ReadingActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reverting, setReverting] = useState(false);
  const [hideRead, setHideRead] = useState(() => readHideReadPreference(listId));
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const onServingFromCacheChangeRef = useRef(onServingFromCacheChange);
  onServingFromCacheChangeRef.current = onServingFromCacheChange;

  useEffect(() => {
    setHideRead(readHideReadPreference(listId));
  }, [listId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function hydrateFromCache(silent: boolean, markAsCache: boolean): boolean {
    const cached = readCachedListDetail(listId);
    const locs = readCachedLocations();
    if (locs) setLocations(locs);
    if (!cached) return false;
    setListName(cached.list.list_name);
    setEntries(cached.entries);
    if (!silent) {
      setSnapshot(snapshotFromEntries(cached.list.list_name, cached.entries));
    }
    setError(null);
    if (markAsCache) onServingFromCacheChangeRef.current?.(true);
    return true;
  }

  async function load(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    setError(null);
    void loadHistoricStats();
    try {
      const [{ list, entries: fetchedEntries }, locs] = await Promise.all([fetchListDetail(listId), fetchLocations()]);
      setListName(list.list_name);
      setEntries(fetchedEntries);
      setLocations(locs);
      writeCachedListDetail(listId, list, fetchedEntries);
      writeCachedLocations(locs);
      onServingFromCacheChangeRef.current?.(false);
      if (!silent) {
        setSnapshot(snapshotFromEntries(list.list_name, fetchedEntries));
      }
    } catch (e) {
      if (silent && entriesRef.current.length > 0) {
        // Keep the last successful view on a quiet refresh failure.
        onServingFromCacheChangeRef.current?.(true);
        return;
      }
      if (hydrateFromCache(silent, true)) {
        return;
      }
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Failed to load reading list.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Collection-wide records and reading activity are optional extras; a failure keeps the last
  // values rather than breaking the page.
  async function loadHistoricStats() {
    try {
      const { listBookCounts, completedDates } = await fetchHistoricReadingData();
      setHistoricStats(calculateHistoricReadingStats(listBookCounts, completedDates));
      setReadingActivity(calculateReadingActivity(completedDates));
    } catch {
      // Leave the previous records (or the placeholder) in place.
    }
  }

  useEffect(() => {
    // Prefer a warm cache paint, then refresh from the network when possible.
    // Do not mark "using cache" until a fetch actually fails.
    const hadCache = hydrateFromCache(false, false);
    if (hadCache) setLoading(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  // Refresh when the tab becomes visible (e.g. after adding comics in the extension)
  // and poll quietly while the tab is open so changes appear without a manual reload.
  useEffect(() => {
    function refreshIfOnline() {
      if (navigator.onLine) {
        void load({ silent: true });
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshIfOnline();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', refreshIfOnline);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshIfOnline();
      }
    }, 20000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', refreshIfOnline);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const visibleEntries = useMemo(() => filterVisibleEntries(entries, hideRead), [entries, hideRead]);
  const readingStats = useMemo(() => calculateListReadingStats(entries), [entries]);
  const currentDateGap = useMemo(() => calculateCurrentDateGap(entries), [entries]);

  const visibleEntryIds = useMemo(
    () => visibleEntries.map((entry) => entry.entry_id),
    [visibleEntries]
  );

  function handleHideReadChange(checked: boolean) {
    setHideRead(checked);
    writeHideReadPreference(listId, checked);
  }

  async function persistOrder(reorderedIds: number[]) {
    if (!requireOnline(readOnly)) return;
    const mergedIds = mergeVisibleEntryOrder(entries, reorderedIds, hideRead);
    setEntries((prev) => {
      const byId = new Map(prev.map((entry) => [entry.entry_id, entry]));
      return mergedIds.map((id, idx) => ({ ...byId.get(id)!, read_order: (idx + 1) * 10 }));
    });
    try {
      await reorderListEntries(listId, mergedIds);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to reorder.');
      void load();
    }
  }

  async function handleTitleSave(newTitle: string) {
    if (!requireOnline(readOnly)) return;
    await updateListTitle(listId, newTitle);
    setListName(newTitle);
    onListRenamed?.();
  }

  async function handleToggleComplete(bookId: number, completed: boolean) {
    if (!requireOnline(readOnly)) return;
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
      void loadHistoricStats();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update.');
      void load();
    }
  }

  async function handleLocationChange(bookId: number, slot: 1 | 2 | 3, locationId: number | null) {
    if (!requireOnline(readOnly)) return;
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
      void load();
    }
  }

  function handleMove(entryId: number, direction: 'up' | 'down') {
    if (!requireOnline(readOnly)) return;
    const reordered = computeStepReorder(visibleEntryIds, entryId, direction);
    if (!reordered) return;
    void persistOrder(reordered);
  }

  function handleDragEnd(event: DragEndEvent) {
    if (readOnly) return;
    const { active, over } = event;
    if (!over) return;
    const reordered = computeDragReorder(visibleEntryIds, Number(active.id), Number(over.id));
    if (!reordered) return;
    void persistOrder(reordered);
  }

  async function handleRemove(entryId: number, title: string) {
    if (!requireOnline(readOnly)) return;
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
    if (!requireOnline(readOnly)) return;
    const name = defaultDividerName(belowBook);
    // Under hide-read, beforeEntryId is the visible unread comic the divider
    // should precede — that maps 1:1 to the full-list insert target.
    const insertBeforeId = resolveDividerInsertBeforeEntryId(beforeEntryId);
    try {
      await createSectionDivider(listId, name, insertBeforeId);
      await load({ silent: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add divider.');
    }
  }

  async function handleUpdateDivider(entryId: number, dividerName: string) {
    if (!requireOnline(readOnly)) return;
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
    if (!requireOnline(readOnly)) return;
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
    if (!requireOnline(readOnly)) return;
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
    if (!requireOnline(readOnly)) return;
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
    if (!requireOnline(readOnly)) return;
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

  const orderingDisabled = readOnly || hideRead;

  return (
    <div className="reading-list-page">
      <div className="list-toolbar">
        <div className="list-toolbar-title">
          <EditableTitle title={listName} onSave={handleTitleSave} disabled={readOnly} />
        </div>
        <HideReadToggle checked={hideRead} onChange={handleHideReadChange} />
      </div>

      <ReadingStats
        stats={readingStats}
        activity={readingActivity}
        currentDateGap={currentDateGap}
        historicStats={historicStats}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleEntryIds} strategy={verticalListSortingStrategy}>
          <div className="book-list">
            {visibleEntries.map((entry, idx) => (
              <Fragment key={entry.entry_id}>
                {entry.entry_type === 'book' && (
                  <DividerInsertZone
                    label={`Insert section divider above ${entry.book.series}`}
                    disabled={readOnly}
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
                    readOnly={readOnly}
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
                    orderingDisabled={orderingDisabled}
                    readOnly={readOnly}
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

      <button
        type="button"
        className="revert-button"
        onClick={handleRevert}
        disabled={reverting || readOnly}
        title={readOnly ? 'Requires network' : undefined}
      >
        {reverting ? 'Reverting…' : 'Revert'}
      </button>
    </div>
  );
}
