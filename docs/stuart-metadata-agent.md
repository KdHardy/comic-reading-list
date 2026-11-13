# Stuart: the comic metadata agent

Stuart goes through the comics in the reading lists and fills in metadata that
helps decide what to read: the canonical **series/volume** each comic belongs to
(so the Pull List groups them properly), the run's **total issues** and whether
it's **ongoing**, the **story arcs** each issue is part of, and blank
**publisher / publish date** fields. It isn't trying to be a definitive comic
database.

## Where it runs

| Piece | Location |
| --- | --- |
| Scanner | Supabase Edge Function `stuart` — `supabase/functions/stuart/` |
| Schema and SQL helpers | `supabase/migrations/0012_stuart_metadata.sql` |
| Nightly schedule | `supabase/migrations/0013_stuart_schedule.sql` (pg_cron + pg_net) |
| Pull List display | `web/src/lib/pullList.ts`, `PullListPage.tsx`, `ScanErrorsDialog.tsx` |

```
pg_cron (every 30 min, 07:00–14:30 UTC)
  └─ stuart_tick()            decides whether tonight needs a batch
       └─ net.http_post ──▶  Edge Function "stuart"
                               ├─ stuart_pending_books()   what to scan
                               ├─ ComicVine API            look-ups (rate-limited)
                               └─ stuart_apply_book_match() / stuart_record_book_failure()
```

## Triggering

- Adding a comic (or editing its series, volume, number, publisher or publish
  date) marks the book `scan_state = 'pending'` via the `trg_book_mark_for_scan`
  trigger. Stuart's own writes don't re-queue books.
- At **midnight US Pacific** (`stuart_config.timezone`), `stuart_tick()` starts a
  batch if any books are pending. Nights with nothing pending make no calls.
- Each batch is capped (~90 ComicVine requests, ~110 s). If books remain,
  `stuart_tick()` starts another batch every 30 minutes until **6 am**, so a big
  backlog (like the first full scan of ~1,200 comics) finishes over a few nights.
- A batch that hits a fatal error (e.g. a rejected API key) stops the rest of
  that night's batches.

## Matching (ComicVine adapter)

A comic is matched on its **name, issue number and reading-list date** together.
A date match is **solid** when the issue's release date (ComicVine's store date,
or its cover date moved back two months when that's all there is) is in the
**same year** as the reading-list date and within **92 days** (about a quarter).

For each group of pending books with the same series/volume/publisher text:

1. Reuse the ComicVine volume already matched for that group, if any.
2. Otherwise search ComicVine for volumes (`/search`, which ranks exact titles
   first; the substring `/volumes?filter=name:…` is a fallback). Keep volumes
   whose **title** matches, ignoring case, punctuation, a leading "The" and
   spelled-out numbers ("Season Eleven" = "Season 11"). If none match exactly,
   a looser in-order word match is allowed ("Buffy Season 9" ~ "Buffy the
   Vampire Slayer Season Nine"). Then keep those whose **publisher** matches
   loosely ("Marvel" = "Marvel Comics"), that **started** on or before the
   comic's date (and in the volume's year, if the book has a year-style volume),
   and that are long enough for the issue numbers.
3. **Pick the volume by date:** for the earliest dated comic, look up its issue
   number in up to 5 candidate volumes and take the one whose release date is a
   solid match and closest.
4. **Check every comic:** each dated comic must be a solid date match with its
   own issue in that volume; one that isn't is recorded as a `date_mismatch`
   failure rather than attached.
5. A series whose comics have **no publish dates** can't be confirmed and is
   recorded as `no_date` for review. Nothing uncertain is guessed.
6. For a matched volume, fetch its issues to map issue numbers, its latest issue
   date (**ongoing** = an issue within the last 90 days or upcoming), and each
   issue's story arcs.

The user's own `book.series / volume / publisher` text is never changed (blank
publisher and publish date are filled when that can't collide with another book).

## Data

| Table / column | Meaning |
| --- | --- |
| `series_volume` | Canonical series/volume: name, start year, publisher, total issues, last issue, ongoing, ComicVine link |
| `book.series_volume_id`, `book.source_issue_id` | The match for each comic |
| `book.scan_state`, `scan_attempts`, `last_scanned_at`, `next_scan_after` | Scan bookkeeping |
| `storyline`, `book_storyline` | Story arcs and which comics are in them (`reading_order_position` is optional and not filled by ComicVine) |
| `stuart_run` | One row per batch: status, counts, requests by resource, note |
| `stuart_scan_error` | Failures per comic, with adapter, code, message and details; `cleared_at` is set once the comic later matches |
| `stuart_config` | Enabled flag, function URL, time zone and nightly window |

On the Pull List, matched comics are grouped under `book_pull_list_key()`:
the ComicVine name, start year and publisher. Status, family, order and title
art set on the old key are carried over the first time a group moves.

## Failures and retries

- If an adapter can't match a group, the next adapter is tried (ComicVine is the
  only one today).
- When every adapter fails, each comic gets `stuart_scan_error` rows and
  `scan_state = 'failed'`. It's retried after **7 days**, at most **3 times**,
  or right away if you edit the comic.
- A comic whose volume matched but whose issue isn't on ComicVine yet is linked
  to the volume and checked again in 30 days.
- The Pull List shows **"N recent scans failed. Click for error conditions."**
  under the summary; the dialog lists each comic's errors and raw details.

## Troubleshooting (SQL editor, Claude or Cursor with the Supabase MCP)

```sql
-- Recent batches
select run_id, trigger, status, started_at, finished_at, books_matched, books_failed, requests, note
from stuart_run order by started_at desc limit 20;

-- Open failures
select series, volume, publisher, number, code, message, details, created_at
from stuart_scan_error where cleared_at is null order by created_at desc;

-- What's waiting
select stuart_pending_count();

-- Why tonight did / didn't run (returns a reason)
select stuart_tick();          -- careful: starts a batch if it's in the window

-- Rescan a comic now
update book set scan_state = 'pending', scan_attempts = 0, next_scan_after = null where book_id = 123;
```

## Running it by hand

The function needs the app's write secret in `x-stuart-secret`. From the SQL
editor (keeps the secret out of logs and chat):

```sql
-- Dry run: look up the first 5 groups and report, without writing anything.
select net.http_post(
  url := (select function_url from stuart_config),
  headers := jsonb_build_object('Content-Type', 'application/json',
                                'x-stuart-secret', (select secret from app_secret)),
  body := '{"dry_run": true, "max_groups": 5}'::jsonb,
  timeout_milliseconds := 150000
);
-- then read the response:
select status_code, content::jsonb from net._http_response order by created desc limit 1;
```

Send `{"trigger": "manual"}` for a real (writing) batch.

## Setup

1. Get a free API key at <https://comicvine.gamespot.com/api/>.
2. Apply `0012_stuart_metadata.sql` and `0013_stuart_schedule.sql`.
3. Deploy the function with JWT verification **off** (it checks the write
   secret itself): `supabase functions deploy stuart --no-verify-jwt`.
4. In the Supabase dashboard → Edge Functions → Secrets, add
   `COMICVINE_API_KEY`.
5. Point the scheduler at the function:
   `update stuart_config set function_url = 'https://<project-ref>.supabase.co/functions/v1/stuart';`
6. Optional: a dry run (above) to check matches before the first night.

To pause Stuart: `update stuart_config set enabled = false;`

## Future work

- More adapters (League of Comic Geeks, Grand Comics Database) as fallbacks.
- Reading-order positions within storylines from articles or wikis.
- A Storylines view on the Pull List.
- Commands to rescan one comic or the whole database on demand.
