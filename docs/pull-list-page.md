# Pull List page

Cross-list series overview for Comic Reading List. One row per distinct series across every reading list, with status, family, title art, and priority order. For the Reading Lists page and shared Supabase/Cloudflare context, see [comiclist-page.md](./comiclist-page.md).

## Purpose

The Pull List answers “which series am I following, and how far through them am I?” It is not a per-list issue queue. Comics already on any reading list are rolled up into series rows; you then set Pull List–only metadata (status, family, title art, order) without changing list membership or per-issue order.

## Route and entry points

| Item | Detail |
| --- | --- |
| Hash route | `#/pull-list` |
| Nav | Header link **Pull List** (alongside **Reading Lists**) |
| Page component | `web/src/components/PullListPage.tsx` |
| Layout | App uses the wider `app-wide` shell on this page; the reading-list picker is hidden |

Routing is hash-based in `web/src/App.tsx`: `window.location.hash === '#/pull-list'` selects the Pull List; anything else shows Reading Lists.

## Layout

### Toolbar

- Title: **Pull List**
- Tabs: **Series** (implemented) and **Storylines** (placeholder: “Storylines are coming soon.”)

### Series view controls

- **Status** filter: All · Read All · Maybe · Skip · No status
- Summary line: `{N} series · {read} / {total} issues read` for the filtered set

### Table columns

| Column | Contents |
| --- | --- |
| Order | ▲ / ▼ and drag handle (☰) |
| Publisher | Series publisher, or — |
| Family | Free-text input with autocomplete from families already in use |
| Title Art | Cropped cover band; click to open the title-art editor |
| Series Title | Series name; volume shown in parentheses when present |
| Volume | Volume string, or — |
| Total Issues | Distinct issues for that series across all lists |
| Issues Read | Count of completed issues plus a progress bar |
| Status | — · Read All · Maybe · Skip |

Rows with status **Skip** use a muted/skipped style. Empty states: no series yet (add comics to a reading list), or no series match the current status filter.

## Interactions

| Action | Behavior |
| --- | --- |
| Status | Optimistic local update, then `set_pull_list_series_status` RPC |
| Family | Commit on blur / Enter; Escape cancels; empty clears family |
| Reorder | Drag-and-drop or ▲/▼; persists via `reorder_pull_list_series`. Disabled while a status filter other than All is active |
| Title art | Opens `TitleArtEditor`: pick a cover from the series’ issues that have thumbnails, drag a crop rectangle, Save / Reset to default / close (Escape or backdrop) |
| Refresh | Full load on mount; silent reload when the browser tab becomes visible again (picks up comics added or marked read elsewhere) |

### Title art defaults

If no cover is chosen, the UI uses the first issue that has a thumbnail and crops the top 25% of the cover (`DEFAULT_TITLE_ART_CROP`: `x:0 y:0 w:1 h:0.25`). Custom choices store a book id plus fractional crop rectangle.

### Status values

| Value | Label |
| --- | --- |
| `read_all` | Read All |
| `maybe` | Maybe |
| `skip` | Skip |
| `null` | No status (—) |

## Data model and sources

### How a series is identified

Same keying as book dedupe for series identity: `(series, volume, publisher)`, with null volume/publisher normalized to `''` on the Pull List side.

### Derived from reading lists (read-time)

Issues are loaded from every `list_entry` of type `book`, joined to `book`. Client code (`buildPullListSeries` in `web/src/lib/pullList.ts`) groups by series key, **de-duplicates by `book_id`** (a book on multiple lists counts once), sorts issues by publish date then issue number, and computes:

- `totalIssues` — distinct books
- `issuesRead` — distinct books with `completed === true`

### Stored Pull List metadata

Table `pull_list_series` (migration `supabase/migrations/0011_pull_list.sql`) stores only user choices:

| Column | Role |
| --- | --- |
| `series`, `volume`, `publisher` | Unique series key |
| `family` | Optional grouping label |
| `status` | `read_all` / `maybe` / `skip` / null |
| `sort_order` | Priority (steps of 10 after reorder) |
| `title_art_book_id` | Cover book; FK to `book`, cleared if book deleted |
| `title_art_x/y/w/h` | Crop as fractions of cover width/height |
| `updated_at` | Last metadata change |

Rows are created **lazily** the first time a series is edited (status, family, title art, or reorder). Series that only appear via list membership and have never been edited have no row until then; the UI still shows them with null metadata and default title art.

### Related tables

| Table | Role for this page |
| --- | --- |
| `list_entry` | Source of which books appear on any list |
| `book` | Series fields, thumbnails, `completed` |
| `pull_list_series` | Pull List–only metadata |
| `reading_list` | Not queried by the Pull List page itself |

## Client API surface

Defined in `web/src/lib/api.ts`:

| Function | Backend |
| --- | --- |
| `fetchPullListIssues()` | `SELECT` on `list_entry` → nested `book` fields |
| `fetchPullListSeriesMeta()` | `SELECT` on `pull_list_series` |
| `setPullListSeriesStatus(key, status)` | RPC `set_pull_list_series_status` |
| `setPullListSeriesFamily(key, family)` | RPC `set_pull_list_series_family` |
| `setPullListSeriesTitleArt(key, bookId, crop)` | RPC `set_pull_list_series_title_art` (`bookId`/`crop` null resets) |
| `reorderPullListSeries(keysInOrder)` | RPC `reorder_pull_list_series` |

Writes require the shared write secret (same pattern as the rest of the app). Table RLS allows public `SELECT` only; mutations go through security-definer RPCs.

### UI building blocks

| File | Role |
| --- | --- |
| `PullListPage.tsx` | Page shell, load/filter/reorder, title-art modal host |
| `PullListSeriesRow.tsx` | One series row |
| `TitleArtEditor.tsx` | Cover + crop modal |
| `SeriesTitleArt.tsx` | Cropped title-art display |
| `lib/pullList.ts` | Aggregation, filter, sort, crop helpers |
| `lib/types.ts` | `PullListIssue`, `PullListSeries`, `PullListSeriesMeta`, etc. |

## Difference from the Reading List view

| | **Reading Lists** (`#/`) | **Pull List** (`#/pull-list`) |
| --- | --- | --- |
| Scope | One selected `reading_list` | All lists, rolled up |
| Unit of display | List entries: books and section dividers in `read_order` | One row per series |
| Primary job | Track and reorder issues on a list; locations, notes, completed, hide-read, stats, revert | Prioritize series; status/family/title art; series-level read progress |
| Ordering | Per-list entry order | Cross-list series priority (`sort_order`) |
| Mutations | List/book RPCs (`reorder_list_entries_v2`, `set_book_completed`, notes, dividers, …) | Pull List RPCs only; does not add/remove list entries |
| Empty state | Create a list / pick a list | Add comics to any reading list first |

Use Reading Lists to manage what you are reading issue-by-issue. Use the Pull List to manage which series matter and how you classify them across the whole collection.
