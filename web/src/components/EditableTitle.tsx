import { useState } from 'react';

interface Props {
  title: string;
  onSave: (newTitle: string) => Promise<void>;
}

export function EditableTitle({ title, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(title);
    setError(null);
    setEditing(false);
  }

  async function commit() {
    if (draft.trim() === '') {
      setError('Title cannot be blank');
      return;
    }
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save title.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <h2 className="list-title">
        {title}
        <button type="button" className="icon-button" aria-label="Edit title" onClick={startEdit}>
          ✏️
        </button>
      </h2>
    );
  }

  return (
    <div className="list-title-edit">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancelEdit();
        }}
        disabled={saving}
      />
      <button type="button" className="icon-button" aria-label="Save title" onClick={commit} disabled={saving}>
        ✔️
      </button>
      <button type="button" className="icon-button" aria-label="Cancel edit" onClick={cancelEdit} disabled={saving}>
        ✖️
      </button>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
