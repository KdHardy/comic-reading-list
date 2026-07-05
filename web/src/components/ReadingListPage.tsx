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
  fetchListDetail,
  fetchLocations,
  removeBookFromList,
  reorderList,
  revertList,
  setBookCompleted,
  setBookLocation,
  snapshotFromRows,
  updateListTitle,
} from '../lib/api';
import type { ListSnapshot, LocationOption, ReadingOrderRow } from '../lib/types';
import { EditableTitle } from './EditableTitle';
import { BookRow } from './BookRow';

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [{ list, rows: fetchedRows }, locs] = await Promise.all([fetchListDetail(listId), fetchLocations()]);
      setListName(list.list_name);
      setRows(fetchedRows);
      setLocations(locs);
      setSnapshot(snapshotFromRows(list.list_name, fetchedRows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reading list.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const bookIdsInOrder = useMemo(() => rows.map((r) => r.book_id), [rows]);

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

  async function persistOrder(newBookIds: number[]) {
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.book_id, r]));
      return newBookIds.map((id, idx) => ({ ...byId.get(id)!, read_order: (idx + 1) * 10 }));
    });
    try {
      await reorderList(listId, newBookIds);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to reorder.');
      load();
    }
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

  function handleMove(bookId: number, direction: 'up' | 'down') {
    const index = bookIdsInOrder.indexOf(bookId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= bookIdsInOrder.length) return;
    persistOrder(arrayMove(bookIdsInOrder, index, targetIndex));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = bookIdsInOrder.indexOf(Number(active.id));
    const newIndex = bookIdsInOrder.indexOf(Number(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    persistOrder(arrayMove(bookIdsInOrder, oldIndex, newIndex));
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
      <EditableTitle title={listName} onSave={handleTitleSave} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={bookIdsInOrder} strategy={verticalListSortingStrategy}>
          <div className="book-list">
            {rows.map((r, idx) => (
              <BookRow
                key={r.book_id}
                book={r.book}
                locations={locations}
                isFirst={idx === 0}
                isLast={idx === rows.length - 1}
                onToggleComplete={handleToggleComplete}
                onMove={handleMove}
                onLocationChange={handleLocationChange}
                onRemove={handleRemove}
              />
            ))}
            {rows.length === 0 && (
              <p className="app-status">No comics in this list yet — add some from the browser extension.</p>
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
