import { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DividerListEntry } from '../lib/types';

interface Props {
  entry: DividerListEntry;
  isFirst: boolean;
  isLast: boolean;
  onMove: (entryId: number, direction: 'up' | 'down') => void;
  onSave: (entryId: number, dividerName: string) => Promise<void>;
  onDelete: (entryId: number, dividerName: string) => void;
}

export function DividerRow({ entry, isFirst, isLast, onMove, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.divider_name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.entry_id,
  });

  useEffect(() => {
    setDraft(entry.divider_name);
  }, [entry.divider_name]);

  async function save() {
    const name = draft.trim();
    if (!name) {
      setError('Divider name cannot be blank.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(entry.entry_id, name);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update divider.');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(entry.divider_name);
    setError(null);
    setEditing(false);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="section-divider">
      <div className="book-nav-buttons">
        <button type="button" disabled={isFirst} onClick={() => onMove(entry.entry_id, 'up')} aria-label="Move divider up">
          ▲
        </button>
        <button type="button" disabled={isLast} onClick={() => onMove(entry.entry_id, 'down')} aria-label="Move divider down">
          ▼
        </button>
      </div>

      <div className="section-divider-line" aria-hidden="true" />

      {editing ? (
        <div className="section-divider-edit">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
              if (event.key === 'Escape') cancel();
            }}
            aria-label="Divider name"
            autoFocus
          />
          <button type="button" onClick={() => void save()} disabled={saving} aria-label="Save divider">
            ✓
          </button>
          <button type="button" onClick={cancel} disabled={saving} aria-label="Cancel divider edit">
            ✕
          </button>
          {error && <span className="divider-error">{error}</span>}
        </div>
      ) : (
        <button type="button" className="section-divider-name" onClick={() => setEditing(true)}>
          {entry.divider_name}
        </button>
      )}

      <div className="section-divider-line" aria-hidden="true" />

      <button
        type="button"
        className="drag-handle"
        aria-label={`Drag divider ${entry.divider_name} to reorder`}
        {...attributes}
        {...listeners}
      >
        ☰
      </button>

      <button
        type="button"
        className="book-delete-button"
        onClick={() => onDelete(entry.entry_id, entry.divider_name)}
        aria-label={`Delete divider ${entry.divider_name}`}
      >
        🗑
      </button>
    </div>
  );
}
