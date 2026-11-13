// Stuart — the comic metadata agent (Supabase Edge Function).
//
// Called by pg_cron through stuart_tick() (see 0013_stuart_schedule.sql), or
// by hand for testing. Every call must send the app's shared write secret in
// the `x-stuart-secret` header. Body (all optional):
//   { "trigger": "nightly" | "manual", "dry_run": true, "max_groups": 5 }
// A dry run looks comics up and returns what it would change without writing.
//
// Secrets: COMICVINE_API_KEY (set in the Supabase dashboard). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ComicVineAdapter } from './comicvine.ts';
import { runScan } from './scan.ts';
import { SupabaseStuartStore } from './store.ts';

// Edge Functions are stopped after ~150 s; leave room to record the result.
const BATCH_TIME_MS = 110_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  const startedAt = Date.now();
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const provided = request.headers.get('x-stuart-secret');
  const { data: secretRow, error: secretError } = await db.from('app_secret').select('secret').limit(1).maybeSingle();
  if (secretError) return json({ error: 'could not read app secret' }, 500);
  if (!provided || !secretRow || provided !== secretRow.secret) return json({ error: 'unauthorized' }, 401);

  let body: { trigger?: string; dry_run?: boolean; max_groups?: number } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body: defaults.
  }
  const trigger = body.trigger === 'nightly' ? 'nightly' : 'manual';
  const dryRun = body.dry_run === true;

  const store = new SupabaseStuartStore(db);
  const apiKey = Deno.env.get('COMICVINE_API_KEY');
  if (!apiKey) {
    if (!dryRun) {
      const runId = await store.startRun(trigger);
      await store.finishRun(runId, {
        status: 'failed',
        matched: 0,
        failed: 0,
        requests: {},
        note: 'COMICVINE_API_KEY is not set in the Edge Function secrets.',
      });
    }
    return json({ error: 'COMICVINE_API_KEY is not set' }, 500);
  }

  const adapters = [
    new ComicVineAdapter({ apiKey, deadline: startedAt + BATCH_TIME_MS }),
  ];

  try {
    const summary = await runScan({
      store,
      adapters,
      trigger,
      dryRun,
      maxGroups: typeof body.max_groups === 'number' ? body.max_groups : undefined,
    });
    return json(summary);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
