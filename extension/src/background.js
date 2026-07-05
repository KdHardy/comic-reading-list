// Chrome/Edge load this as a service worker with only this one file referenced
// from the manifest, so it must pull in its dependencies itself via
// importScripts(). Firefox instead lists all of these files directly in the
// manifest's background.scripts array, where importScripts isn't defined
// (it's not a worker context there) — hence the guard below.
if (typeof importScripts === 'function') {
  importScripts('lib/browser-polyfill.js', 'lib/config.js', 'lib/api.js', 'lib/messaging.js');
}

/** @type {Array<{tempId: string} & Record<string, unknown>>} */
let pendingItems = [];

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
      return { pending: pendingItems };

    case MSG.GET_PENDING:
      return { pending: pendingItems };

    case MSG.REMOVE_PENDING:
      pendingItems = pendingItems.filter((i) => i.tempId !== message.payload.tempId);
      return { pending: pendingItems };

    case MSG.CLEAR_PENDING:
      pendingItems = [];
      return { pending: pendingItems };

    case MSG.SUBMIT_PENDING: {
      const { listId } = message.payload;
      for (const item of pendingItems) {
        // eslint-disable-next-line no-await-in-loop
        await addBookToList(listId, item);
      }
      pendingItems = [];
      return { pending: pendingItems };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
