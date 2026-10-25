import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TITLE_ART_CROP, formatSeriesTitle, isUsableCrop, normalizeCrop } from '../lib/pullList';
import type { PullListIssue, PullListSeries, TitleArtCrop } from '../lib/types';
import { SeriesTitleArt, useCoverSrc } from './SeriesTitleArt';

interface Props {
  series: PullListSeries;
  onSave: (bookId: number, crop: TitleArtCrop) => void | Promise<void>;
  onReset: () => void | Promise<void>;
  onClose: () => void;
}

function CoverChoice({ issue, selected, onSelect }: { issue: PullListIssue; selected: boolean; onSelect: () => void }) {
  const src = useCoverSrc(issue);
  return (
    <button
      type="button"
      className={`title-art-cover-choice${selected ? ' title-art-cover-choice-selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Use cover of #${issue.number ?? '?'}`}
      title={issue.number ? `#${issue.number}` : undefined}
    >
      {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span />}
    </button>
  );
}

/** Pick which cover supplies a series' title art and drag a box around the title logo. */
export function TitleArtEditor({ series, onSave, onReset, onClose }: Props) {
  const covers = series.issues.filter((issue) => issue.thumbnail);
  const [issue, setIssue] = useState<PullListIssue | null>(series.titleArt?.issue ?? covers[0] ?? null);
  const [crop, setCrop] = useState<TitleArtCrop>(series.titleArt?.crop ?? DEFAULT_TITLE_ART_CROP);
  const [saving, setSaving] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const src = useCoverSrc(issue);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function pointerFraction(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStart.current = pointerFraction(e);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const next = normalizeCrop(dragStart.current, pointerFraction(e));
    if (isUsableCrop(next)) setCrop(next);
  }

  function handlePointerUp() {
    dragStart.current = null;
  }

  async function run(action: () => void | Promise<void>) {
    setSaving(true);
    try {
      await action();
    } finally {
      setSaving(false);
    }
  }

  const title = formatSeriesTitle(series);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal title-art-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="title-art-editor-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="title-art-editor-heading">Title art · {title}</h2>

        {covers.length === 0 ? (
          <p className="app-status">None of this series' issues have a cover image yet.</p>
        ) : (
          <>
            <p className="title-art-editor-hint">Choose a cover, then drag a box around the series logo.</p>
            <div className="title-art-cover-choices">
              {covers.map((cover) => (
                <CoverChoice
                  key={cover.book_id}
                  issue={cover}
                  selected={cover.book_id === issue?.book_id}
                  onSelect={() => setIssue(cover)}
                />
              ))}
            </div>

            <div className="title-art-editor-body">
              <div
                className="title-art-crop-area"
                data-testid="title-art-crop-area"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {src && <img src={src} alt={`${title} cover`} draggable={false} referrerPolicy="no-referrer" />}
                <div
                  className="title-art-crop-box"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                  }}
                />
              </div>

              <div className="title-art-preview">
                <span className="title-art-preview-label">Preview</span>
                <SeriesTitleArt issue={issue} crop={crop} maxWidth={220} maxHeight={90} />
              </div>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="modal-secondary"
            disabled={saving || series.titleArt?.isDefault !== false}
            onClick={() => run(onReset)}
            title="Go back to the top of the first available cover"
          >
            Use default
          </button>
          <span className="modal-actions-spacer" />
          <button type="button" className="modal-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-primary"
            disabled={saving || !issue}
            onClick={() => issue && run(() => onSave(issue.book_id, crop))}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
