import { useCallback, useEffect, useRef, useState } from 'react';
import { createReadingList, fetchLists } from './lib/api';
import { useOnlineStatus } from './lib/onlineStatus';
import { readCachedLists, writeCachedLists } from './lib/readingListCache';
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

function applyLists(
  data: ReadingListSummary[],
  preferListId: number | undefined,
  setLists: (lists: ReadingListSummary[]) => void,
  setSelectedListId: (id: number | null) => void
) {
  setLists(data);
  if (data.length === 0) {
    setSelectedListId(null);
    saveListId(null);
  } else {
    const candidate = pickListId(data, preferListId);
    setSelectedListId(candidate);
    saveListId(candidate);
  }
}

export default function App() {
  const [lists, setLists] = useState<ReadingListSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState<number | null>(readSavedListId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingCache, setUsingCache] = useState(false);
  const [page, setPage] = useState<Page>(pageFromHash);
  const online = useOnlineStatus();
  const listsRef = useRef(lists);
  listsRef.current = lists;

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
      writeCachedLists(data);
      applyLists(data, preferListId, setLists, setSelectedListId);
      setUsingCache(false);
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load reading lists.';
      if (listsRef.current.length > 0) {
        // Keep the last successful view; do not wipe on a failed refresh.
        setUsingCache(true);
        setError(null);
        return;
      }
      const cached = readCachedLists();
      if (cached && cached.length > 0) {
        applyLists(cached, preferListId, setLists, setSelectedListId);
        setUsingCache(true);
        setError(null);
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedLists();
    if (cached && cached.length > 0) {
      // Warm paint from cache; only mark "using cache" if the network refresh fails.
      applyLists(cached, undefined, setLists, setSelectedListId);
      setLoading(false);
    }
    void reloadLists();
  }, [reloadLists]);

  // Pick up new lists created in the browser extension when returning to this tab.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void reloadLists(selectedListId ?? undefined);
      }
    }
    function onOnline() {
      void reloadLists(selectedListId ?? undefined);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    };
  }, [reloadLists, selectedListId]);

  function handleListChange(listId: number) {
    setSelectedListId(listId);
    saveListId(listId);
  }

  async function handleCreateList() {
    if (!online) {
      alert('Creating a list requires a network connection.');
      return;
    }
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

  const showOfflineBanner = !online || usingCache;

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
              <button type="button" onClick={handleCreateList} disabled={!online} title={!online ? 'Requires network' : undefined}>
                + New list
              </button>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      {page === 'lists' && showOfflineBanner && (
        <div className="offline-banner" role="status">
          {!online
            ? 'Offline — showing cached reading list (read-only).'
            : 'Showing cached reading list — could not refresh from the network.'}
        </div>
      )}

      <main>
        {page === 'pull-list' ? (
          <PullListPage />
        ) : selectedListId ? (
          <ReadingListPage
            listId={selectedListId}
            readOnly={!online}
            onListRenamed={() => void reloadLists(selectedListId)}
            onServingFromCacheChange={setUsingCache}
          />
        ) : (
          <p className="app-status">Create a reading list to get started.</p>
        )}
      </main>
    </div>
  );
}
