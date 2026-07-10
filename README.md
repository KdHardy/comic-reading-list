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
├── web/                  React + Vite Reading List page (deploys to Cloudflare Pages)
└── extension/            Manifest V3 browser extension (Edge + Firefox)
```

## 1. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run the migration files in `supabase/migrations/` **in order**
   (`0001_init_schema.sql`, `0002_functions.sql`, `0003_security.sql`,
   `0004_remove_book_from_list.sql`, then `0005_notes.sql`). Alternatively, if you have the
   [Supabase CLI](https://supabase.com/docs/guides/cli) installed, `supabase link` this project and
   run `supabase db push`.
3. Set your write secret — this is what stands in for authentication, since the app has no login.
   Run in the SQL Editor (pick your own random string):
   ```sql
   insert into app_secret (secret) values ('choose-a-long-random-string-here');
   ```
4. From **Project Settings → API**, copy your **Project URL** and **anon public key** — you'll need
   both for the web app and the extension.

## 2. Set up the web app

```
cd web
npm install
cp .env.example .env   # then fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_WRITE_SECRET
npm run dev
```

Open the printed local URL to try it out. `npm run build` produces the `dist/` folder Cloudflare
Pages serves.

### Deploying to Cloudflare Pages

1. Push this repo to GitHub (see below).
2. In the Cloudflare dashboard, create a Pages project connected to the repo.
3. Build settings: root directory `web`, build command `npm run build`, output directory `dist`.
4. Add the three `VITE_*` environment variables from `web/.env` in the Pages project's settings.
5. Every push to the connected branch redeploys automatically.

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
