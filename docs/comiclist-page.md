# ComicList / Reading List page

Solo comic reading-list app: ordered issues + section dividers per list, Supabase backend, Cloudflare Worker frontend, browser extension for capture. This doc orients on the **Reading Lists** page and shared infra. For the cross-list series overview see [pull-list-page.md](./pull-list-page.md).

## What ComicList is

| Item | Detail |
| --- | --- |
| Product | Personal (single-user) comic reading lists: web UI + Supabase + browser extension |
| Production URL | `https://comic-reading-list.khardy-271.workers.dev/` |
| Legacy Worker URL | `https://comic-reading-list.mpnrfphs6d.workers.dev/` (older Cloudflare account; still referenced in `PLAN.md`) |
| Repo | `github.com/KdHardy/comic-reading-list` |
| Layout | `web/` (Vite/React), `supabase/migrations/`, `extension/` |

Auth model today: shared write secret (`app_secret` + `VITE_WRITE_SECRET`), not user login. **CL-1** (open): replace browser-exposed write credential with authenticated server-side writes — risk only; do not implement from this doc.

## ComicList / Reading List page

### Route and shell

| Item | Detail |
| --- | --- |
| Hash route | `#/` (anything other than `#/pull-list`) |
| Nav | Header **Reading Lists** · **Pull List** |
| Page component | `web/src/components/ReadingListPage.tsx` |
| Shell / picker | `web/src/App.tsx` — list `<select>`, **+ New list**, theme toggle; last list id in `localStorage` key `comic-reading-list:lastListId` |

### Main UI pieces

- **List picker** — all `reading_list` rows; create via `create_reading_list` RPC; editable list title (`EditableTitle` → `update_list_title`).
- **Hide read** — `HideReadToggle`; preference per list: `comic-reading-list:hideRead:{listId}` (`'1'` / `'0'`).
- **Reading stats** — `ReadingStats`: Total comics, Comics read (current list); Read this week, Current streak, Current date gap (collection-wide extras); historic “longest / best” details when available.
- **Book rows** — `BookRow`: complete checkbox, ▲/▼ + drag handle (`@dnd-kit`), thumbnail, title `{Series} (Vol {Volume}) #{Number}`, publisher + publish date, **Location 1 / Location 2** dropdowns, notes (`NoteList`), delete.
- **Location 3** — column exists on `book`; **hidden in UI** (`LOCATION_FIELDS` = `location1_id`, `location2_id` only).
- **Section dividers** — `DividerRow` (inline rename / clear / complete / drag / delete; no left ▲/▼); insert via `DividerInsertZone` hover line + **+** above each **visible book**.
- **Revert** — snapshot of list name + books/dividers at load (`listSnapshot.ts`); restores via `revert_list_entries_v2`.
- **Refresh** — full load on `listId` change; silent reload on tab visibility + 20s poll while visible (extension adds).

### Order model

- Canonical order: `list_entry.read_order` (ascending), then `entry_id`.
- Client persists order as entry-id arrays via `reorder_list_entries_v2`; optimistic `read_order` steps of 10.
- Drag / ▲/▼ operate on **visible** entry ids; with hide-read on, `mergeVisibleEntryOrder` reinserts hidden completed books (and hidden dividers) anchored to the nearest preceding **visible book** so a divider placed before an unread stays immediately before that unread in the full list.

### Divider insert / edit / hide-read rules (as implemented)

| Rule | Behavior |
| --- | --- |
| Insert target | Hover/insert zone only above **book** rows (not above dividers) |
| Default name | `defaultDividerName(bookBelow)` → `Publisher + Date`, else publisher, else date, else `New Section`; persisted once — never recomputed on move |
| Insert RPC | `create_section_divider_v2(p_list_id, p_divider_name, p_before_entry_id)` |
| Hide-read insert | `beforeEntryId` = visible unread book’s `entry_id` (`resolveDividerInsertBeforeEntryId` is identity) |
| Hide-read visibility | Completed books hidden. A divider is shown only if the book-run **above** and **below** it each contain ≥1 unread (`filterVisibleEntries`) |
| Rename | `update_section_divider_v2`; blank names rejected in UI |
| Delete | Same `delete_list_entry_v2` path as books |

Helpers: `web/src/lib/listOrder.ts`, `web/src/lib/divider.ts`.

## Data model (Supabase)

### Tables that matter

| Table | Role |
| --- | --- |
| `reading_list` | Lists: `list_id`, `list_name`, `completed`, `created_date`, `completed_date` |
| `list_entry` | **Canonical** mixed order: books + named dividers |
| `reading_order` | Book-only **compatibility mirror** (rollback / older clients); kept in sync by 0010 RPCs |
| `book` | Issue row; dedupe `(series, volume, number, publisher)`; locations, completed, thumbnail fields |
| `location` | Lookup for location dropdowns |
| `note` | Per-book notes (`note_id`, `book_id`, `note_text`, `created_at`) |
| `pull_list_series` | Pull List metadata only (not used by Reading List page UI) |
| `app_secret` | Single-row write secret; **not** exposed via PostgREST |

### `list_entry` (canonical order + dividers)

| Column | Notes |
| --- | --- |
| `entry_id` | `bigserial` PK |
| `list_id` | FK → `reading_list` |
| `entry_type` | `'book'` \| `'divider'` |
| `book_id` | Required for books; null for dividers |
| `divider_name` | Required non-blank for dividers; null for books |
| `read_order` | Integer order within list |

Unique: one book per list (`(list_id, book_id)` where `entry_type = 'book'`). RLS: public `SELECT` only; mutations via security-definer RPCs + `_check_secret`.

### Key migrations

| File | Purpose |
| --- | --- |
| `0001_init_schema.sql` | `location`, `reading_list`, `book`, `reading_order`, `app_secret` + seeds |
| `0002_functions.sql` / `0003_security.sql` | RPCs + RLS |
| `0004_remove_book_from_list.sql` | Remove-from-list |
| `0005_notes.sql` | `note` + note RPCs |
| `0006` / `0007` | Thumbnail / re-add behavior; `thumbnail_data`, `thumbnail_mime`, `thumbnail_cached_at` |
| `0008_add_kobo_neon_ichiban_locations.sql` | Seeds `Kobo`, `Neon Ichiban` |
| `0009_repair_reading_order.sql` | Idempotent repair if `reading_order` missing from schema cache / relation |
| `0010_restore_list_entry_canonical.sql` | Restores `list_entry` as canonical; mirrors books into `reading_order`; `_v2` entry RPCs |
| `0011_pull_list.sql` | `pull_list_series` + Pull List RPCs |

Verify scripts: `supabase/verify_reading_order_repair.sql`, `supabase/verify_list_entry_recovery.sql`.

### Location dropdown source

- UI loads `location` via `fetchLocations()` → `location_id`, `location_name` ordered by `location_id`.
- Migration seeds: Local, Marvel Unlimited, DC Universe Infinite, Hoopla, Comixology (+ Kobo, Neon Ichiban in 0008).
- **Production data (not a repo migration):** exact name `Hoopla` was renamed in place to **`Hoopla (KCLS)`** (`location_id = 4`); new row **`Hoopla (SPL)`** (`location_id = 8`). Existing book FKs to id 4 kept working. See store audit `internal/hoopla-kcls-spl-location-split-audit.md`.
- Writes: RPC `set_book_location(p_book_id, p_slot 1|2|3, p_location_id)`.

### Reading List write RPCs (client)

From `web/src/lib/api.ts` (all pass `p_secret: WRITE_SECRET`):

| Client | RPC |
| --- | --- |
| `createReadingList` | `create_reading_list` |
| `updateListTitle` | `update_list_title` |
| `setBookCompleted` | `set_book_completed` |
| `setBookLocation` | `set_book_location` |
| `deleteListEntry` | `delete_list_entry_v2` |
| `createSectionDivider` | `create_section_divider_v2` |
| `updateSectionDivider` | `update_section_divider_v2` |
| `reorderListEntries` | `reorder_list_entries_v2` |
| `revertList` | `revert_list_entries_v2` |
| `addNote` / `updateNote` / `deleteNote` | `add_note` / `update_note` / `delete_note` |
| `saveBookThumbnail` | `save_book_thumbnail` |

Reads: PostgREST `SELECT` on `reading_list`, `list_entry` (nested `book` + `notes`), `location`, `book` (historic completed dates).

## App architecture

### Stack

- `web/` — Vite + React 18 + TypeScript; Vitest for unit/migration tests.
- Supabase JS client: `web/src/lib/supabaseClient.ts` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WRITE_SECRET`).
- Entry: `web/src/main.tsx` → `App.tsx`.

### Important Reading List files

| Path | Role |
| --- | --- |
| `components/ReadingListPage.tsx` | Page state, load/reorder/hide-read/dividers/stats/revert |
| `components/BookRow.tsx` | Issue row UI |
| `components/DividerRow.tsx` / `DividerInsertZone.tsx` | Dividers |
| `components/HideReadToggle.tsx` / `EditableTitle.tsx` / `ReadingStats.tsx` / `NoteList.tsx` | Toolbar / stats / notes |
| `lib/api.ts` | Supabase reads + RPCs |
| `lib/listOrder.ts` | Visibility, merge, drag/step reorder, hide-read prefs |
| `lib/divider.ts` | Default divider names |
| `lib/listSnapshot.ts` | Revert snapshot |
| `lib/readingStats.ts` / `historicReadingStats.ts` / `currentDateGap.ts` | Stats math |
| `lib/types.ts` | `ListEntry`, `Book`, `ListSnapshot`, … |
| `lib/thumbnail.ts` / `thumbnailCache.ts` / `BookThumbnail.tsx` | Cover display + cache |

### Writes today vs CL-1

Writes go **browser → Supabase RPC** with `VITE_WRITE_SECRET` embedded in the client bundle (also set as Cloudflare Workers Builds vars). RLS blocks direct table writes for anon. **Open risk (CL-1):** that secret is visible to anyone who can load the site; planned fix is server-side authenticated writes — out of scope for page feature work unless explicitly assigned.

Optional Worker function `web/functions/thumb.js` proxies allowed `*.nocookie.net` thumbnail hosts (CORS helper); primary app is static assets from `dist/`.

## Cloudflare

| Item | Detail |
| --- | --- |
| Deploy target | Cloudflare **Workers** static assets (Workers Builds / Git integration) |
| Worker name | `comic-reading-list` (`web/wrangler.jsonc`) |
| Root directory | `web/` |
| Build | `npm run build` (`tsc -b && vite build` → `dist/`) |
| Deploy | `npm run deploy` (`wrangler deploy`) |
| Config notes | No `account_id` or `routes` in repo; SPA `not_found_handling`; portable across accounts |
| Production hostname | `comic-reading-list.khardy-271.workers.dev` (account subdomain `khardy-271`) |
| Build env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WRITE_SECRET` (Vite embeds all three in the client) |

Git-connected: merges to `master` trigger Workers Builds from `web/`. PR previews may appear as `*-comic-reading-list.khardy-271.workers.dev`. Confirm rollouts in Worker **Deployments → Build history**. Details: `README.md`, `DEPLOYMENT.md`.

## CI / deploy automation

| Workflow | File | Role |
| --- | --- | --- |
| Web CI | `.github/workflows/web-ci.yml` | On PR/`master` push: guarded-deploy policy test, `npm ci`, `npm test`, `npm run test:migration`, `npm run build`. Contents: **read** only. Check name: **Web tests and build** |
| Guarded deploy | `.github/workflows/guarded-deploy.yml` | On PR comment exactly `/deploy`: validate + merge to `master` (does **not** talk to Cloudflare) |

### `/deploy` (high level)

1. PR ready, not behind `master`, **Web tests and build** green.
2. Comment `/deploy` from a human with write/maintain/admin **or** verified Cursor GitHub App (`cursor[bot]` + app provenance; Cursor only for `cursor/*` branches).
3. Gate pins head SHA, re-checks CI/permissions, merges; Cloudflare Builds then deploys `master`.
4. PRs that change `.github/workflows/` or `.github/deploy/` cannot self-deploy — admin merge required.
5. Logic: `.github/deploy/guarded-deploy.cjs` (+ `guarded-deploy.test.cjs`).

GitHub Actions holds **no** Cloudflare credentials. Deploy workflow token needs `checks:read`, `contents:write`, `issues:write`, `pull-requests:write` (PR comments + merge).

Local client env names (not values): see `web/.env.example` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WRITE_SECRET`.

## Cursor / agent ops

| Secret / var name | Where | Use |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Cursor **environment secrets** (not chat) | Service-role REST / admin bypass of RLS for agent DB work |
| `SUPABASE_PROJECT_REF` | Cursor env secrets | Project ref (production historically `jfpgdeeutglgbgdvihbo`) |
| `SUPABASE_DB_PASSWORD` | Cursor env secrets | Direct Postgres when usable; may be unset/wrong on some VMs |
| `VITE_*` / `app_secret` | Cloudflare Builds / `web/.env` / DB row | Browser app + write RPCs — **not** the service role |

Agents must not paste secret **values** into docs, PRs, or chat. Prefer service-role REST against the project URL when mutating locations or verifying schema; treat production list data as live.

## Related docs

- [Pull List page](./pull-list-page.md) — `#/pull-list` series overview (`PullListPage.tsx`)
- Repo: `README.md`, `DEPLOYMENT.md`, `PLAN.md` (PLAN may lag on Worker URL / checklist)
- Store audits (internal): hide-read/dividers, Hoopla KCLS/SPL split, production deploy verification
