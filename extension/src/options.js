const supabaseUrlInput = document.getElementById('supabaseUrl');
const anonKeyInput = document.getElementById('anonKey');
const writeSecretInput = document.getElementById('writeSecret');
const statusEl = document.getElementById('status');

async function load() {
  const config = await getConfig();
  supabaseUrlInput.value = config.supabaseUrl;
  anonKeyInput.value = config.anonKey;
  writeSecretInput.value = config.writeSecret;
}

document.getElementById('save').addEventListener('click', async () => {
  await setConfig({
    supabaseUrl: supabaseUrlInput.value.trim().replace(/\/$/, ''),
    anonKey: anonKeyInput.value.trim(),
    writeSecret: writeSecretInput.value.trim(),
  });
  statusEl.textContent = 'Saved.';
  setTimeout(() => (statusEl.textContent = ''), 2000);
});

load();
