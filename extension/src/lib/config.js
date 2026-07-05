/** Extension settings, entered on the options page and stored in browser.storage.local. */
const DEFAULT_CONFIG = { supabaseUrl: '', anonKey: '', writeSecret: '' };

async function getConfig() {
  const stored = await browser.storage.local.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...stored };
}

async function setConfig(partial) {
  await browser.storage.local.set(partial);
}
