/**
 * Minimal cross-browser polyfill covering only the APIs this extension uses
 * (storage.local, runtime messaging, tabs, openOptionsPage).
 *
 * Firefox already provides a native promise-based `browser` global, so this
 * only kicks in on Chrome/Edge (which only expose callback-based `chrome`).
 * If you later need more of the WebExtensions surface, swap this out for the
 * full `webextension-polyfill` npm package instead of extending this by hand.
 */
(function () {
  if (typeof browser !== 'undefined' || typeof chrome === 'undefined') return;

  function promisify(fn, thisArg) {
    return (...args) =>
      new Promise((resolve, reject) => {
        fn.call(thisArg, ...args, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      });
  }

  globalThis.browser = {
    storage: {
      local: {
        get: promisify(chrome.storage.local.get, chrome.storage.local),
        set: promisify(chrome.storage.local.set, chrome.storage.local),
      },
    },
    runtime: {
      sendMessage: promisify(chrome.runtime.sendMessage, chrome.runtime),
      onMessage: chrome.runtime.onMessage,
      openOptionsPage: promisify(chrome.runtime.openOptionsPage, chrome.runtime),
    },
    tabs: {
      query: promisify(chrome.tabs.query, chrome.tabs),
      sendMessage: promisify(chrome.tabs.sendMessage, chrome.tabs),
    },
  };
})();
