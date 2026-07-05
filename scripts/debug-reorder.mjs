// One-off diagnostic script: calls reorder_list RPC, then re-fetches the
// rows to check whether the change actually persisted server-side. Reads
// credentials from web/.env (never printed). Restores original order after.
import { readFileSync } from 'node:fs';

const envText = readFileSync(new URL('../web/.env', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SECRET = env.VITE_WRITE_SECRET;
const LIST_ID = 2;

async function fetchOrder() {
  const res = await fetch(`${URL_BASE}/rest/v1/reading_order?select=book_id,read_order&list_id=eq.${LIST_ID}&order=read_order.asc`, {
    headers: { apikey: ANON },
  });
  return res.json();
}

async function reorder(bookIds) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/reorder_list`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: SECRET, p_list_id: LIST_ID, p_book_ids: bookIds }),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

const before = await fetchOrder();
console.log('BEFORE:', before.map((r) => r.book_id));

const originalIds = before.map((r) => r.book_id);
const swapped = [...originalIds];
[swapped[0], swapped[1]] = [swapped[1], swapped[0]];

const rpcResult = await reorder(swapped);
console.log('RPC status:', rpcResult.status, 'body:', rpcResult.body);

const after = await fetchOrder();
console.log('AFTER:', after.map((r) => r.book_id));

const changed = JSON.stringify(after.map((r) => r.book_id)) === JSON.stringify(swapped);
console.log('DID IT PERSIST?', changed);

// restore original order regardless of outcome
const restoreResult = await reorder(originalIds);
console.log('Restore status:', restoreResult.status);
const final = await fetchOrder();
console.log('FINAL (should match BEFORE):', final.map((r) => r.book_id));
