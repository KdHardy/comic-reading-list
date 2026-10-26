import { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DEFAULT_TITLE_ART_CROP, PULL_LIST_STATUSES, formatSeriesTitle } from '../lib/pullList';
import type { PullListSeries, PullListStatus } from '../lib/types';
import { SeriesTitleArt } from './SeriesTitleArt';

export const FAMILY_DATALIST_ID = 'pull-list-families';

interface Props {
  series: PullListSeries;
  isFirst: boolean;
  isLast: boolean;
  orderingDisabled: boolean;
  onMove: (key: string, direction: 'up' | 'down') => void;
  onStatusChange: (series: PullListSeries, status: PullListStatus | null) => void;
  onFamilyChange: (series: PullListSeries, family: string | null) => void;
  onEditTitleArt: (series: PullListSeries) => void;
}

function FamilyInput({ series, onSave }: { series: PullListSeries; onSave: (family: string | null) => void }) {
  const [draft, setDraft] = useState(series.family ?? '');

  useEffect(() => setDraft(series.family ?? ''), [series.family]);

  function commit() {
    const next = draft.trim() || null;
    if (next !== series.family) onSave(next);
    else setDraft(series.family ?? '');
  }

  return (
    <input
      className="pull-list-family-input"
      value={draft}
      list={FAMILY_DATALIST_ID}
      placeholder="Add family"
      aria-label={`Family for ${formatSeriesTitle(series)}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          const input = e.currentTarget;
          setDraft(series.family ?? '');
          // Blur after the reset renders so the blur commit sees an unchanged value.
          requestAnimationFrame(() => input.blur());
        }
      }}
    />
  );
}

export function PullListSeriesRow({
  series,
  isFirst,
  isLast,
  orderingDisabled,
  onMove,
  onStatusChange,
  onFamilyChange,
  onEditTitleArt,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: series.key,
    disabled: orderingDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const title = formatSeriesTitle(series);
  const allRead = series.totalIssues > 0 && series.issuesRead === series.totalIssues;
  const readPercent = series.totalIssues ? Math.round((series.issuesRead / series.totalIssues) * 100) : 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="row"
      className={`pull-list-row${series.status === 'skip' ? ' pull-list-row-skipped' : ''}`}
    >
      <div role="cell" className="pull-list-order">
        <div className="book-nav-buttons">
          <button
            type="button"
            disabled={isFirst || orderingDisabled}
            onClick={() => onMove(series.key, 'up')}
            aria-label={`Move ${title} up`}
          >
            ▲
          </button>
          <button
            type="button"
            disabled={isLast || orderingDisabled}
            onClick={() => onMove(series.key, 'down')}
            aria-label={`Move ${title} down`}
          >
            ▼
          </button>
        </div>
        <button
          type="button"
          className="drag-handle"
          aria-label={`Drag ${title} to reorder`}
          disabled={orderingDisabled}
          title={orderingDisabled ? 'Show all statuses to reorder' : undefined}
          {...attributes}
          {...listeners}
        >
          ☰
        </button>
      </div>

      <div role="cell" className="pull-list-publisher">
        {series.publisher || <span className="pull-list-muted">—</span>}
      </div>

      <div role="cell" className="pull-list-family">
        <FamilyInput series={series} onSave={(family) => onFamilyChange(series, family)} />
      </div>

      <div role="cell" className="pull-list-title-art">
        <button
          type="button"
          className={`pull-list-title-art-button${series.titleArt?.isDefault !== false ? ' pull-list-title-art-default' : ''}`}
          onClick={() => onEditTitleArt(series)}
          aria-label={`Edit title art for ${title}`}
          title={series.titleArt?.isDefault !== false ? 'Default title art — click to choose a cover and crop' : 'Edit title art'}
        >
          <SeriesTitleArt
            issue={series.titleArt?.issue ?? null}
            crop={series.titleArt?.crop ?? DEFAULT_TITLE_ART_CROP}
          />
        </button>
      </div>

      <div role="cell" className="pull-list-series-title">
        {series.series}
        {series.volume && <span className="pull-list-title-volume"> ({series.volume})</span>}
      </div>

      <div role="cell" className="pull-list-volume">
        {series.volume || <span className="pull-list-muted">—</span>}
      </div>

      <div role="cell" className="pull-list-total">
        {series.totalIssues}
      </div>

      <div role="cell" className="pull-list-read" data-total={series.totalIssues}>
        <span className={allRead ? 'pull-list-read-complete' : undefined}>{series.issuesRead}</span>
        <span
          className="pull-list-progress"
          role="progressbar"
          aria-label={`${title} read progress`}
          aria-valuemin={0}
          aria-valuemax={series.totalIssues}
          aria-valuenow={series.issuesRead}
        >
          <span style={{ width: `${readPercent}%` }} />
        </span>
      </div>

      <div role="cell" className="pull-list-status">
        <select
          value={series.status ?? ''}
          onChange={(e) => onStatusChange(series, (e.target.value || null) as PullListStatus | null)}
          aria-label={`Status for ${title}`}
          className={series.status ? `pull-list-status-${series.status}` : undefined}
        >
          <option value="">—</option>
          {PULL_LIST_STATUSES.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
