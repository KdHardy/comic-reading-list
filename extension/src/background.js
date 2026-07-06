// Chrome/Edge load this as a service worker with only this one file referenced
// from the manifest, so it must pull in its dependencies itself via
// importScripts(). Firefox instead lists all of these files directly in the
// manifest's background.scripts array, where importScripts isn't defined
// (it's not a worker context there) — hence the guard below.
if (typeof importScripts === 'function') {
  importScripts('lib/browser-polyfill.js', 'lib/config.js', 'lib/api.js', 'lib/messaging.js');
}

const PENDING_STORAGE_KEY = 'pendingItems';

/** @type {Array<{tempId: string} & Record<string, unknown>>} */
let pendingItems = [];
let submitting = false;

async function loadPendingFromStorage() {
  const stored = await browser.storage.local.get(PENDING_STORAGE_KEY);
  pendingItems = Array.isArray(stored[PENDING_STORAGE_KEY]) ? stored[PENDING_STORAGE_KEY] : [];
}

async function savePendingToStorage() {
  await browser.storage.local.set({ [PENDING_STORAGE_KEY]: pendingItems });
}

loadPendingFromStorage();

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true; // keep the message channel open for the async response above
});

async function handleMessage(message) {
  switch (message.type) {
    case MSG.ITEM_DETECTED:
      pendingItems.push({ tempId: crypto.randomUUID(), ...message.payload });
      await savePendingToStorage();
      return { pending: pendingItems };

    case MSG.GET_PENDING:
      await loadPendingFromStorage();
      return { pending: pendingItems };

    case MSG.REMOVE_PENDING:
      pendingItems = pendingItems.filter((i) => i.tempId !== message.payload.tempId);
      await savePendingToStorage();
      return { pending: pendingItems };

    case MSG.CLEAR_PENDING:
      pendingItems = [];
      await savePendingToStorage();
      return { pending: pendingItems };

    case MSG.SUBMIT_PENDING: {
      if (submitting) {
        throw new Error('A submit is already in progress. Please wait.');
      }
      const { listId } = message.payload;
      if (!listId || Number.isNaN(Number(listId))) {
        throw new Error('No reading list selected.');
      }

      await loadPendingFromStorage();
      if (pendingItems.length === 0) {
        throw new Error('No comics to submit.');
      }

      submitting = true;
      const failed = [];
      const succeededIds = new Set();

      try {
        for (const item of pendingItems) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await addBookToList(listId, item);
            succeededIds.add(item.tempId);
          } catch (e) {
            failed.push({ item, error: e instanceof Error ? e : new Error(String(e)) });
          }
        }

        pendingItems = pendingItems.filter((i) => !succeededIds.has(i.tempId));
        await savePendingToStorage();

        if (failed.length > 0) {
          const label = failed[0].item.series ?? 'item';
          throw new Error(
            `Added ${succeededIds.size}, but ${failed.length} failed (e.g. "${label}": ${failed[0].error.message}). ` +
              'The rest remain in the queue — click Submit again to retry.'
          );
        }

        return { pending: pendingItems, added: succeededIds.size };
      } finally {
        submitting = false;
      }
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
