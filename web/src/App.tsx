import { useCallback, useEffect, useState } from 'react';
import { createReadingList, fetchLists } from './lib/api';
import type { ReadingListSummary } from './lib/types';
import { PullListPage } from './components/PullListPage';
import { ReadingListPage } from './components/ReadingListPage';
import { ThemeToggle } from './components/ThemeToggle';

const LAST_LIST_KEY = 'comic-reading-list:lastListId';
const PULL_LIST_HASH = '#/pull-list';

type Page = 'lists' | 'pull-list';

function pageFromHash(): Page {
  return window.location.hash === PULL_LIST_HASH ? 'pull-list' : 'lists';
}

function readSavedListId(): number | null {
  const raw = localStorage.getItem(LAST_LIST_KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function saveListId(listId: number | null) {
  if (listId == null) localStorage.removeItem(LAST_LIST_KEY);
  else localStorage.setItem(LAST_LIST_KEY, String(listId));
}

function pickListId(lists: ReadingListSummary[], preferListId?: number): number {
  const savedId = readSavedListId();
  if (preferListId != null && lists.some((l) => l.list_id === preferListId)) {
    return preferListId;
  }
  if (savedId != null && lists.some((l) => l.list_id === savedId)) {
    return savedId;
  }
  return lists[0].list_id;
}

export default function App() {
  const [lists, setLists] = useState<ReadingListSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState<number | null>(readSavedListId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    function onHashChange() {
      setPage(pageFromHash());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const reloadLists = useCallback(async (preferListId?: number) => {
    try {
      const data = await fetchLists();
      setLists(data);
      if (data.length === 0) {
        setSelectedListId(null);
        saveListId(null);
      } else {
        const candidate = pickListId(data, preferListId);
        setSelectedListId(candidate);
        saveListId(candidate);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reading lists.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadLists();
  }, [reloadLists]);

  // Pick up new lists created in the browser extension when returning to this tab.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        reloadLists();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [reloadLists]);

  function handleListChange(listId: number) {
    setSelectedListId(listId);
    saveListId(listId);
  }

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
    <div className={`app${page === 'pull-list' ? ' app-wide' : ''}`}>
      <header className="app-header">
        <div className="app-header-start">
          <h1 className="app-brand">Comic Reading List</h1>
          <nav className="app-nav" aria-label="Pages">
            <a href="#/" aria-current={page === 'lists' ? 'page' : undefined}>
              Reading Lists
            </a>
            <a href={PULL_LIST_HASH} aria-current={page === 'pull-list' ? 'page' : undefined}>
              Pull List
            </a>
          </nav>
        </div>
        <div className="app-list-picker">
          {page === 'lists' && (
            <>
              <select
                value={selectedListId ?? ''}
                onChange={(e) => handleListChange(Number(e.target.value))}
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
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main>
        {page === 'pull-list' ? (
          <PullListPage />
        ) : selectedListId ? (
          <ReadingListPage listId={selectedListId} onListRenamed={() => reloadLists(selectedListId)} />
        ) : (
          <p className="app-status">Create a reading list to get started.</p>
        )}
      </main>
    </div>
  );
}
