import { useEffect, useState } from 'react';
import { createReadingList, fetchLists } from './lib/api';
import type { ReadingListSummary } from './lib/types';
import { ReadingListPage } from './components/ReadingListPage';

export default function App() {
  const [lists, setLists] = useState<ReadingListSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reloadLists(preferListId?: number) {
    try {
      const data = await fetchLists();
      setLists(data);
      if (data.length === 0) {
        setSelectedListId(null);
      } else if (preferListId && data.some((l) => l.list_id === preferListId)) {
        setSelectedListId(preferListId);
      } else if (!selectedListId) {
        setSelectedListId(data[0].list_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reading lists.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateList() {
    const name = window.prompt('New reading list name:');
    if (!name || !name.trim()) return;
    try {
      const newId = await createReadingList(name.trim());
      await reloadLists(newId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create list.');
    }
  }

  if (loading) return <div className="app-status">Loading…</div>;
  if (error) return <div className="app-status app-status-error">{error}</div>;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-brand">Comic Reading List</h1>
        <div className="app-list-picker">
          <select
            value={selectedListId ?? ''}
            onChange={(e) => setSelectedListId(Number(e.target.value))}
            aria-label="Choose reading list"
          >
            {lists.length === 0 && <option value="">No lists yet</option>}
            {lists.map((l) => (
              <option key={l.list_id} value={l.list_id}>
                {l.list_name}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleCreateList}>
            + New list
          </button>
        </div>
      </header>

      <main>
        {selectedListId ? (
          <ReadingListPage listId={selectedListId} onListRenamed={() => reloadLists(selectedListId)} />
        ) : (
          <p className="app-status">Create a reading list to get started.</p>
        )}
      </main>
    </div>
  );
}
