import { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DividerListEntry } from '../lib/types';

interface Props {
  entry: DividerListEntry;
  orderingDisabled: boolean;
  onSave: (entryId: number, dividerName: string) => Promise<void>;
  onDelete: (entryId: number, dividerName: string) => void;
}

export function DividerRow({ entry, orderingDisabled, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.divider_name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.entry_id,
    disabled: orderingDisabled,
  });

  useEffect(() => {
    setDraft(entry.divider_name);
  }, [entry.divider_name]);

  function startEdit() {
    setDraft(entry.divider_name);
    setError(null);
    setEditing(true);
  }

  // "Clear" — discard the in-progress edit and restore the persisted name.
  function clearEdit() {
    setDraft(entry.divider_name);
    setError(null);
    setEditing(false);
  }

  // "Complete" — persist the edit.
  async function completeEdit() {
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="section-divider">
      <div className="section-divider-line" aria-hidden="true" />

      {editing ? (
        <div className="section-divider-edit">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void completeEdit();
              if (event.key === 'Escape') clearEdit();
            }}
            aria-label="Divider name"
            autoFocus
            disabled={saving}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Save divider name"
            onClick={() => void completeEdit()}
            disabled={saving}
          >
            ✔️
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel divider edit"
            onClick={clearEdit}
            disabled={saving}
          >
            ✖️
          </button>
          {error && <span className="field-error">{error}</span>}
        </div>
      ) : (
        <span className="section-divider-name">
          {entry.divider_name}
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit divider ${entry.divider_name}`}
            onClick={startEdit}
          >
            ✏️
          </button>
        </span>
      )}

      <div className="section-divider-line" aria-hidden="true" />

      <button
        type="button"
        className="drag-handle"
        aria-label="Drag to reorder"
        disabled={orderingDisabled}
        {...attributes}
        {...listeners}
      >
        ☰
      </button>

      <button
        type="button"
        className="book-delete-button"
        aria-label={`Remove divider "${entry.divider_name}" from list`}
        title="Remove from list"
        onClick={() => onDelete(entry.entry_id, entry.divider_name)}
      >
        🗑
      </button>
    </div>
  );
}
