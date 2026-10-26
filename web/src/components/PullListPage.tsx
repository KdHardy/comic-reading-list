import { useEffect, useMemo, useState } from 'react';
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
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  fetchPullListIssues,
  fetchPullListSeriesMeta,
  reorderPullListSeries,
  setPullListSeriesFamily,
  setPullListSeriesStatus,
  setPullListSeriesTitleArt,
} from '../lib/api';
import {
  DEFAULT_TITLE_ART_CROP,
  PULL_LIST_STATUSES,
  buildPullListSeries,
  familyOptions,
  filterPullListSeries,
  type PullListStatusFilter,
} from '../lib/pullList';
import type { PullListSeries, PullListStatus, TitleArtCrop } from '../lib/types';
import { FAMILY_DATALIST_ID, PullListSeriesRow } from './PullListSeriesRow';
import { TitleArtEditor } from './TitleArtEditor';

type PullListView = 'series' | 'storylines';

const COLUMNS = [
  { label: 'Order', className: 'pull-list-order' },
  { label: 'Publisher', className: 'pull-list-publisher' },
  { label: 'Family', className: 'pull-list-family' },
  { label: 'Title Art', className: 'pull-list-title-art' },
  { label: 'Series Title', className: 'pull-list-series-title' },
  { label: 'Volume', className: 'pull-list-volume' },
  { label: 'Total Issues', className: 'pull-list-total' },
  { label: 'Issues Read', className: 'pull-list-read' },
  { label: 'Status', className: 'pull-list-status' },
];

export function PullListPage() {
  const [view, setView] = useState<PullListView>('series');
  const [series, setSeries] = useState<PullListSeries[]>([]);
  const [statusFilter, setStatusFilter] = useState<PullListStatusFilter>('all');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function load(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const [issues, metadata] = await Promise.all([fetchPullListIssues(), fetchPullListSeriesMeta()]);
      setSeries(buildPullListSeries(issues, metadata));
      setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load the pull list.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Pick up comics added or read elsewhere when returning to this tab.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') load({ silent: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const visibleSeries = useMemo(() => filterPullListSeries(series, statusFilter), [series, statusFilter]);
  const families = useMemo(() => familyOptions(series), [series]);
  const orderingDisabled = statusFilter !== 'all';
  const editingSeries = editingKey ? series.find((s) => s.key === editingKey) ?? null : null;

  function updateSeries(key: string, patch: Partial<PullListSeries>) {
    setSeries((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function persistOrder(reordered: PullListSeries[]) {
    setSeries(reordered.map((s, idx) => ({ ...s, sortOrder: (idx + 1) * 10 })));
    try {
      await reorderPullListSeries(reordered);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to reorder.');
      load();
    }
  }

  function handleMove(key: string, direction: 'up' | 'down') {
    const from = series.findIndex((s) => s.key === key);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= series.length) return;
    persistOrder(arrayMove(series, from, to));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = series.findIndex((s) => s.key === active.id);
    const to = series.findIndex((s) => s.key === over.id);
    if (from < 0 || to < 0) return;
    persistOrder(arrayMove(series, from, to));
  }

  async function handleStatusChange(target: PullListSeries, status: PullListStatus | null) {
    updateSeries(target.key, { status });
    try {
      await setPullListSeriesStatus(target, status);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update status.');
      load();
    }
  }

  async function handleFamilyChange(target: PullListSeries, family: string | null) {
    updateSeries(target.key, { family });
    try {
      await setPullListSeriesFamily(target, family);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update family.');
      load();
    }
  }

  async function handleTitleArtSave(target: PullListSeries, bookId: number, crop: TitleArtCrop) {
    try {
      await setPullListSeriesTitleArt(target, bookId, crop);
      const issue = target.issues.find((i) => i.book_id === bookId);
      if (issue) updateSeries(target.key, { titleArt: { issue, crop, isDefault: false } });
      setEditingKey(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save title art.');
    }
  }

  async function handleTitleArtReset(target: PullListSeries) {
    try {
      await setPullListSeriesTitleArt(target, null, null);
      const firstCover = target.issues.find((i) => i.thumbnail);
      updateSeries(target.key, {
        titleArt: firstCover ? { issue: firstCover, crop: DEFAULT_TITLE_ART_CROP, isDefault: true } : null,
      });
      setEditingKey(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to reset title art.');
    }
  }

  const totals = useMemo(
    () => ({
      issues: visibleSeries.reduce((sum, s) => sum + s.totalIssues, 0),
      read: visibleSeries.reduce((sum, s) => sum + s.issuesRead, 0),
    }),
    [visibleSeries]
  );

  return (
    <div className="pull-list-page">
      <div className="list-toolbar">
        <h2 className="list-title">Pull List</h2>
        <div className="pull-list-tabs" role="tablist" aria-label="Pull list view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'series'}
            className={view === 'series' ? 'pull-list-tab-active' : undefined}
            onClick={() => setView('series')}
          >
            Series
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'storylines'}
            className={view === 'storylines' ? 'pull-list-tab-active' : undefined}
            onClick={() => setView('storylines')}
          >
            Storylines
          </button>
        </div>
      </div>

      {view === 'storylines' ? (
        <p className="app-status">Storylines are coming soon.</p>
      ) : loading ? (
        <div className="app-status">Loading pull list…</div>
      ) : error ? (
        <div className="app-status app-status-error">{error}</div>
      ) : (
        <>
          <div className="pull-list-controls">
            <label className="pull-list-filter">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as PullListStatusFilter)}
                aria-label="Filter by status"
              >
                <option value="all">All</option>
                {PULL_LIST_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
                <option value="unset">No status</option>
              </select>
            </label>
            <span className="pull-list-summary">
              {visibleSeries.length} series · {totals.read} / {totals.issues} issues read
            </span>
          </div>

          <datalist id={FAMILY_DATALIST_ID}>
            {families.map((family) => (
              <option key={family} value={family} />
            ))}
          </datalist>

          <div className="pull-list-table" role="table" aria-label="Series pull list">
            <div className="pull-list-header" role="row">
              {COLUMNS.map((column) => (
                <div key={column.label} role="columnheader" className={column.className}>
                  {column.label}
                </div>
              ))}
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={visibleSeries.map((s) => s.key)} strategy={verticalListSortingStrategy}>
                <div className="pull-list-body" role="rowgroup">
                  {visibleSeries.map((s, idx) => (
                    <PullListSeriesRow
                      key={s.key}
                      series={s}
                      isFirst={idx === 0}
                      isLast={idx === visibleSeries.length - 1}
                      orderingDisabled={orderingDisabled}
                      onMove={handleMove}
                      onStatusChange={handleStatusChange}
                      onFamilyChange={handleFamilyChange}
                      onEditTitleArt={(target) => setEditingKey(target.key)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {series.length === 0 && (
              <p className="app-status">No series yet — add comics to a reading list to see them here.</p>
            )}
            {series.length > 0 && visibleSeries.length === 0 && (
              <p className="app-status">No series match this status.</p>
            )}
          </div>
        </>
      )}

      {editingSeries && (
        <TitleArtEditor
          series={editingSeries}
          onSave={(bookId, crop) => handleTitleArtSave(editingSeries, bookId, crop)}
          onReset={() => handleTitleArtReset(editingSeries)}
          onClose={() => setEditingKey(null)}
        />
      )}
    </div>
  );
}
