# Comic Reading List

A solo-use app for building comic reading lists: a responsive web page for viewing/reordering
lists, backed by Supabase, plus a browser extension that scrapes comic details from a handful of
sites and adds them to a list. See [PLAN.md](PLAN.md) for the full design rationale, feature
checklist, and remaining work.

## Project layout

```
comic-reading-list/
├── supabase/
│   └── migrations/       SQL migrations: schema, RPC functions, RLS policies
├── web/                  React + Vite Reading List page (Cloudflare Worker static assets)
└── extension/            Manifest V3 browser extension (Edge + Firefox)
```

## 1. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run the migration files in `supabase/migrations/` **in numeric order**.
   Alternatively, if you have the [Supabase CLI](https://supabase.com/docs/guides/cli) installed,
   `supabase link` this project and run `supabase db push`.
3. Set your write secret — this is what stands in for authentication, since the app has no login.
   Run in the SQL Editor (pick your own random string):
   ```sql
   insert into app_secret (secret) values ('choose-a-long-random-string-here');
   ```
4. From **Project Settings → API**, copy your **Project URL** and **anon public key** — you'll need
   both for the web app and the extension.

### Repairing a missing `reading_order` relation

If PostgREST reports `PGRST205` for `public.reading_order`, do not replay the initial migration:

1. Back up the database and confirm `reading_list`, `book`, and `app_secret` exist.
2. In the SQL Editor for the affected project, run
   `supabase/migrations/0009_repair_reading_order.sql`.
3. Run `supabase/verify_reading_order_repair.sql`. It raises an exception on any schema,
   privilege, policy, or RPC mismatch.
4. Confirm an anonymous `GET /rest/v1/reading_order?select=list_id,book_id,read_order&limit=1`
   returns `200`, then reload the web app.

The repair is idempotent and does not touch lookup seeds, books, or lists. If the table was truly
missing rather than only absent from PostgREST's schema cache, it is recreated empty; restoring
historical list-to-book associations requires a separate data backup.

### Restoring canonical mixed entries and dividers

Migration `0010_restore_list_entry_canonical.sql` makes `list_entry` the canonical source for
ordered books and dividers while retaining `reading_order` as a compatibility mirror:

1. Back up the database. Before applying, confirm there are no duplicate `book` entries for the
   same `(list_id, book_id)` in `list_entry`; the migration aborts safely if the unique index
   cannot be created.
2. Run `supabase/migrations/0010_restore_list_entry_canonical.sql` in the SQL Editor. It preserves
   existing entry IDs and dividers and backfills only books missing from `list_entry`.
3. Run `supabase/verify_list_entry_recovery.sql`.
4. Deploy the web build only after the migration and verification succeed. The preceding web
   release remains compatible during this interval through the mirrored `reading_order` table.
5. Verify a divider-heavy list and a list backfilled from `reading_order`, then exercise add,
   rename, delete, drag reorder, and Revert on a disposable test list.

For rollback, restore the previous Worker version first. Leave `list_entry` and its data in place;
the compatibility RPCs and `reading_order` mirror support the preceding frontend. If database
function rollback is required, restore the pre-migration definitions captured from
`pg_get_functiondef` or the database backup rather than dropping `list_entry`.

## 2. Set up the web app

```
cd web
npm install
cp .env.example .env   # then fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_WRITE_SECRET
npm run dev
```

Open the printed local URL to try it out. `npm run build` produces the `dist/` folder Cloudflare
Workers serves as static assets.

### Deploying with Cloudflare Workers Builds

1. In the target Cloudflare account, go to **Workers & Pages → Create application → Import a
   repository**, authorize GitHub, and select this repository.
2. Set the production branch to `master`, root directory to `web`, build command to
   `npm run build`, and deploy command to `npm run deploy`.
3. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_WRITE_SECRET` as build variables.
   Vite embeds all three values in the client bundle, so marking one encrypted only hides it from
   build logs; it does not make the resulting browser value secret.
4. Save and deploy. The checked-in Wrangler configuration creates a static-assets Worker named
   `comic-reading-list`; it intentionally contains no account ID or route.

The new account receives its own
`comic-reading-list.<new-account-subdomain>.workers.dev` URL. Deploying there does not change or
remove a Worker with the same name in another account.

## 3. Set up the browser extension

The extension has no build step — it's loaded straight from `extension/`.

1. Open `extension/src/lib/config.js`-backed settings via the extension's **Options** page (see
   below) and enter your Supabase URL, anon key, and the write secret from step 1.3 above.
2. **Edge** (or Chrome): go to `edge://extensions`, enable **Developer mode**, click **Load
   unpacked**, and select the `extension/` folder — it uses `manifest.chrome.json`... Edge/Chrome
   look for a file literally named `manifest.json`, so copy or rename `manifest.chrome.json` to
   `manifest.json` before loading (or symlink it) — see the note below.
3. **Firefox**: go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and
   select `manifest.firefox.json` renamed/copied to `manifest.json` in the same way. Temporary
   add-ons are removed when Firefox restarts; for a persistent install you'd package and sign it
   (see Mozilla's docs on `web-ext sign`).

**Why two manifests?** Chrome/Edge (Manifest V3) expect a background **service worker**; Firefox's
Manifest V3 implementation instead expects a background **page script**. Both manifests are kept in
this repo (`manifest.chrome.json` / `manifest.firefox.json`) and only the active one needs to be
present as `manifest.json` when loading the extension — copy whichever one you need:

```
# Windows PowerShell, from the extension/ folder
Copy-Item manifest.chrome.json manifest.json    # for Edge/Chrome
# or
Copy-Item manifest.firefox.json manifest.json   # for Firefox
```

`manifest.json` itself is gitignored on purpose so this copy step doesn't create merge noise.
After pulling extension changes, re-sync and reload:

```
cd extension
./sync-manifest.ps1    # or: Copy-Item manifest.chrome.json manifest.json
```

Then reload the extension in Edge and **refresh any open comic-site tabs** so the new content
scripts inject.

### Site adapter status

All six adapters exist in `extension/src/adapters/`. See [PLAN.md](PLAN.md) for the full table.
Summary:

| Adapter | Status |
|---|---|
| `comicBookHerald.js` | Verified (including plain-text bullet items) |
| `leagueOfComicGeeks.js` | Verified (list + detail pages) |
| `hoopla.js` | Verified (detail pages) |
| `fandomWiki.js` | Verified (Fandom wiki comic list tables; e.g. Buffy publication order) |
| `amazonComixology.js` | Best-effort — verify on live Amazon pages |
| `marvelUnlimited.js` | Best-effort — public marvel.com pages only |
| `dcUniverseInfinite.js` | Best-effort — public dc.com pages only |

## Database schema

See `supabase/migrations/0001_init_schema.sql` for the full definitions. Summary:

- `reading_list` — a list (`list_id`, `list_name`, `completed`, `created_date`, `completed_date`)
- `book` — a comic issue, deduplicated on `(series, volume, number, publisher)`
- `reading_order` — join table (`list_id`, `book_id`, `read_order`)
- `location` — fixed lookup table (Local, Marvel Unlimited, DC Universe Infinite, Hoopla, Comixology)
- `note` — one or more free-text notes per book (`note_id`, `book_id`, `note_text`, `created_at`); see
  `0005_notes.sql`. Book-level rather than list-level, since a book has one canonical set of notes
  regardless of which list(s) it's on.
- `app_secret` — single-row table holding the shared write secret; never exposed via the REST API

All writes go through the RPC functions in `0002_functions.sql`/`0005_notes.sql` (`add_book_to_list`,
`reorder_list`, `revert_list`, `add_note`, `update_note`, `delete_note`, etc.), each checking the
shared secret before touching data. Direct table writes are blocked by the RLS policies in
`0003_security.sql`/`0005_notes.sql` — only `SELECT` is allowed.

## Status

The core app is built and deployed. See [PLAN.md](PLAN.md) for the full feature checklist.

**Done:** database schema (5 migrations), web reading list page (reorder, revert, delete, notes,
auto-refresh, list memory), browser extension (capture mode, six adapters, reliable submit),
Cloudflare Pages deployment.

**Not started / deferred:** automated tests, iPad Safari extension research, offline viewing.
