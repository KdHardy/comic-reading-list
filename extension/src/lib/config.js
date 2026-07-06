/**
 * Extension settings, stored in browser.storage.local. supabaseUrl/anonKey/writeSecret are
 * entered on the options page; lastListId is set automatically as the popup's list picker is
 * used, so the picker remembers your last-selected list across popup open/close cycles (e.g.
 * closing the popup to enter capture mode, then reopening it later to submit).
 */
const DEFAULT_CONFIG = { supabaseUrl: '', anonKey: '', writeSecret: '', lastListId: null };

async function getConfig() {
  const stored = await browser.storage.local.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...stored };
}

async function setConfig(partial) {
  await browser.storage.local.set(partial);
}
