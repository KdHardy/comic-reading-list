import { useState } from 'react';
import type { Note } from '../lib/types';

interface Props {
  notes: Note[];
  onAdd: (text: string) => void | Promise<void>;
  onUpdate: (noteId: number, text: string) => void | Promise<void>;
  onDelete: (noteId: number) => void | Promise<void>;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const URL_TEST = /^https?:\/\//;

function linkify(text: string) {
  return text.split(URL_REGEX).map((part, i) =>
    URL_TEST.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function NoteList({ notes, onAdd, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState('');

  function startEdit(note: Note) {
    setEditingId(note.note_id);
    setDraft(note.note_text);
  }

  function startNew() {
    setEditingId('new');
    setDraft('');
  }

  function cancel() {
    setEditingId(null);
    setDraft('');
  }

  async function commit() {
    const text = draft.trim();
    const target = editingId;
    setEditingId(null);
    setDraft('');

    if (target === 'new') {
      if (text) await onAdd(text);
    } else if (target !== null) {
      if (text) await onUpdate(target, text);
      else await onDelete(target);
    }
  }

  return (
    <div className="book-notes">
      <div className="book-notes-header">
        <span className="book-notes-label">Notes</span>
        <button type="button" className="note-add-button" onClick={startNew} aria-label="Add note" title="Add note">
          +
        </button>
      </div>
      <div className="book-notes-list">
        {notes.map((note) =>
          editingId === note.note_id ? (
            <textarea
              key={note.note_id}
              className="note-edit-textarea"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancel();
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
              }}
              placeholder="Clear text to delete this note"
            />
          ) : (
            <div key={note.note_id} className="note-item" onClick={() => startEdit(note)} title="Click to edit">
              {linkify(note.note_text)}
            </div>
          )
        )}
        {editingId === 'new' && (
          <textarea
            className="note-edit-textarea"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
            }}
            placeholder="Type a note…"
          />
        )}
        {notes.length === 0 && editingId !== 'new' && <div className="book-notes-empty">No notes yet</div>}
      </div>
    </div>
  );
}
