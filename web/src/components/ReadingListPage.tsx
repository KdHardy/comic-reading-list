import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import {
  addNote,
  deleteNote,
  fetchListDetail,
  fetchLocations,
  removeBookFromList,
  reorderList,
  revertList,
  setBookCompleted,
  setBookLocation,
  snapshotFromRows,
  updateListTitle,
  updateNote,
} from '../lib/api';
import { mergeVisibleOrder, readHideReadPreference, writeHideReadPreference } from '../lib/listOrder';
import { calculateReadingStats } from '../lib/readingStats';
import type { ListSnapshot, LocationOption, ReadingOrderRow } from '../lib/types';
import { EditableTitle } from './EditableTitle';
import { HideReadToggle } from './HideReadToggle';
import { BookRow } from './BookRow';
import { ReadingStats } from './ReadingStats';

interface Props {
  listId: number;
  onListRenamed?: () => void;
}

export function ReadingListPage({ listId, onListRenamed }: Props) {
  const [listName, setListName] = useState('');
  const [rows, setRows] = useState<ReadingOrderRow[]>([]);
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
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  async function load(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [{ list, rows: fetchedRows }, locs] = await Promise.all([fetchListDetail(listId), fetchLocations()]);
      setListName(list.list_name);
      setRows(fetchedRows);
      setLocations(locs);
      if (!silent) {
        setSnapshot(snapshotFromRows(list.list_name, fetchedRows));
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

  const visibleRows = useMemo(
    () => (hideRead ? rows.filter((row) => !row.book.completed) : rows),
    [rows, hideRead]
  );
  const readingStats = useMemo(() => calculateReadingStats(rows), [rows]);

  const visibleBookIds = useMemo(() => visibleRows.map((row) => row.book_id), [visibleRows]);

  function handleHideReadChange(checked: boolean) {
    setHideRead(checked);
    writeHideReadPreference(listId, checked);
  }

  async function persistOrder(reorderedIds: number[]) {
    const mergedIds = mergeVisibleOrder(rows, reorderedIds, hideRead);
    setRows((prev) => {
      const byId = new Map(prev.map((row) => [row.book_id, row]));
      return mergedIds.map((id, idx) => ({ ...byId.get(id)!, read_order: (idx + 1) * 10 }));
    });
    try {
      await reorderList(listId, mergedIds);
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
    setRows((prev) =>
      prev.map((r) =>
        r.book_id === bookId
          ? { ...r, book: { ...r.book, completed, completed_date: completed ? new Date().toISOString() : null } }
          : r
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
    setRows((prev) => prev.map((r) => (r.book_id === bookId ? { ...r, book: { ...r.book, [field]: locationId } } : r)));
    try {
      await setBookLocation(bookId, slot, locationId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update location.');
      load();
    }
  }

  function handleMove(bookId: number, direction: 'up' | 'down') {
    const index = visibleBookIds.indexOf(bookId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= visibleBookIds.length) return;
    persistOrder(arrayMove(visibleBookIds, index, targetIndex));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleBookIds.indexOf(Number(active.id));
    const newIndex = visibleBookIds.indexOf(Number(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    persistOrder(arrayMove(visibleBookIds, oldIndex, newIndex));
  }

  async function handleRemove(bookId: number, title: string) {
    if (!window.confirm(`Remove "${title}" from this list?`)) return;
    const previousRows = rows;
    setRows((prev) => prev.filter((r) => r.book_id !== bookId));
    try {
      await removeBookFromList(listId, bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove.');
      setRows(previousRows);
    }
  }

  async function handleAddNote(bookId: number, text: string) {
    try {
      const note = await addNote(bookId, text);
      setRows((prev) =>
        prev.map((r) => (r.book_id === bookId ? { ...r, book: { ...r.book, notes: [...r.book.notes, note] } } : r))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add note.');
    }
  }

  async function handleUpdateNote(noteId: number, text: string) {
    const previousRows = rows;
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        book: { ...r.book, notes: r.book.notes.map((n) => (n.note_id === noteId ? { ...n, note_text: text } : n)) },
      }))
    );
    try {
      await updateNote(noteId, text);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update note.');
      setRows(previousRows);
    }
  }

  async function handleDeleteNote(noteId: number) {
    const previousRows = rows;
    setRows((prev) =>
      prev.map((r) => ({ ...r, book: { ...r.book, notes: r.book.notes.filter((n) => n.note_id !== noteId) } }))
    );
    try {
      await deleteNote(noteId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete note.');
      setRows(previousRows);
    }
  }

  function handleThumbnailCached(bookId: number) {
    const cachedAt = new Date().toISOString();
    setRows((prev) =>
      prev.map((row) =>
        row.book_id === bookId ? { ...row, book: { ...row.book, thumbnail_cached_at: cachedAt } } : row
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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleBookIds} strategy={verticalListSortingStrategy}>
          <div className="book-list">
            {visibleRows.map((r, idx) => (
              <BookRow
                key={r.book_id}
                book={r.book}
                locations={locations}
                isFirst={idx === 0}
                isLast={idx === visibleRows.length - 1}
                onToggleComplete={handleToggleComplete}
                onMove={handleMove}
                onLocationChange={handleLocationChange}
                onRemove={handleRemove}
                onAddNote={handleAddNote}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onThumbnailCached={handleThumbnailCached}
              />
            ))}
            {rows.length === 0 && (
              <p className="app-status">No comics in this list yet — add some from the browser extension.</p>
            )}
            {rows.length > 0 && hideRead && visibleRows.length === 0 && (
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
