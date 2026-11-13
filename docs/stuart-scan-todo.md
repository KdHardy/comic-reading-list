# Stuart scan fixes — to-do

From the first nightly scan (2026-11-13, 12 batches): **448 matched · 123 failed · 659 still pending**.
The 123 failures come from 40 series groups. They're consolidated below by root cause, biggest
impact first. Tick an item when its fix is merged and the affected comics have been re-scanned.

Re-scan a fixed group:
`update book set scan_state = 'pending', scan_attempts = 0, next_scan_after = null where series = '…';`

## Logic fixes

- [x] **1. Alias: "Buffy Classic" → *Buffy the Vampire Slayer* (1998, Dark Horse)** — 62 comics
  - Done: `stuart_series_alias` table (migration 0014), seeded with this alias. Add rows for
    other wiki names: `insert into stuart_series_alias (alias, title, start_year, publisher) values (…);`
  - The wiki calls the 1998–2003 run "Buffy Classic". ComicVine's "Buffy the Vampire Slayer
    Classic" (2011) is a reprint line and was correctly rejected.
  - Fix: a small alias table (user text → search title), checked before searching.
    Also covers the "Buffy Classic …" variants in item 5.

- [x] **2. The right run isn't in the top 10 search results** — 21 comics, 6 groups
  - Done: issue lookup by number + release window (±1 month, then ±1 quarter, same year), using
    the group's highest-numbered dated comic. Live check: Batman → 2016, Black Widow → 2020,
    Cable → 2020, both Daredevil groups → 2019.
  - **Angel: The Hollower** (3 comics) isn't on ComicVine at all, so it stays a failure until
    another adapter is added.
  - Batman #109–113 (2021), Black Widow #9–10, Cable #11–12, Daredevil #31–34 (two groups),
    Angel: The Hollower #1–3. Only older runs were returned (e.g. Batman 1940), so no date matched.
  - Fix: when no candidate verifies, look the issue up directly: `/issues` filtered by
    `issue_number` and a `store_date` window around the reading-list date, then keep issues whose
    volume title matches. This is exactly the "name + number + date" rule, in one request.

- [ ] **3. Hard filters that the date check already covers** — 6 comics, 3 groups
  - Publisher: "Angel" and "Buffy the Vampire Slayer" listed as *Dynamite* (5 comics) were rejected
    on publisher before any date check.
  - Start year: "Compass: The Cauldron of Eternal Life" #1 (2021-06-16) was rejected because
    ComicVine says the volume started in 2022.
  - Fix: make publisher and start year ranking hints, not rejections; the same-year/quarter issue
    date check decides. (Matches the agreed rule: name + issue number + date.)

- [ ] **4. Title variants** — 4 comics
  - "Captain America Annual 2021" ↔ "Captain America Annual" (2021);
    "Catwoman Annual 2021" ↔ "Catwoman 2021 Annual";
    "Batman Day 2021: Batman – The World Special Edition" ↔ "Batman: The World Batman Day Special Edition";
    "Batman: Knightwatch / The Batman & Scooby-Doo Mysteries" (flip book).
  - Fix: treat a 4-digit year in the title as a volume-year hint and drop it for matching; allow an
    any-order word match (still date-verified); try each side of " / " separately.

- [ ] **5. Format labels with no issue number** — 22 comics, 22 groups
  - Partly done: "… short" and "… extra" (11 comics) are now `skipped` with no error, as decided.
    One-shots, OGNs and "vol. N" (11 comics) still to do.
  - "… one-shot", "… OGN", "… short", "… extra", "… vol. 1/2" (e.g. "Angel OGN", "Buffy Season 8
    one-shot", "Buffy Season 9 short"). All have a publish date but no issue number, so there's
    nothing to verify against.
  - Fix (one-shot / OGN / vol. N): strip the label, find the volume, and accept a single-issue
    volume (or the issue) released in the same year and quarter.

- [ ] **6. One bad date picks the wrong run for a whole group** — 5 comics
  - "Buffy the Last Vampire Slayer": the earliest-dated comic (#3, 2021-02-09) was used to choose
    the volume, but its date looks a year off (#2 is 2022-01-12). #5 (2023-12-06) is probably the
    2023 series.
  - Fix: verify the volume with up to 3 dated comics and take the majority instead of trusting
    the earliest one.

- [ ] **7. A series name that spans several runs** — 1 comic
  - "Black Panther" #3 (2022-01-26) was checked against the 2018 run chosen for the rest of the
    group, so it failed with `date_mismatch`. It belongs to the 2021 run.
  - Fix: when a comic fails its own date check, resolve it again by itself (item 2's issue lookup)
    instead of recording a failure.

## Operational

- [x] **8. ComicVine rate limit hit at 1:30 am (HTTP 420), 2 batches lost**
  - Done: each batch sums the last hour's requests from `stuart_run` and stops a resource at 180
    per rolling hour (the batch ends as `partial` and the next one carries on).
  - Batches at 00:00, 00:30 and 01:00 made 178 per-issue requests in under an hour; ComicVine allows
    about 200 per resource per hour, so the 01:30 batch went over.
  - Fix: before each batch, sum `stuart_run.requests` for the last 60 minutes and cap each resource
    at ~180 per rolling hour.

## Data fixes (your reading lists)

- [ ] **9. Comics with no publish date** — 2 comics: *Absolute Catwoman* #2 and *Angel* #35
  (neither has a publisher either). Add the date and Stuart re-scans them the next night.
- [ ] **10. Check *Buffy the Last Vampire Slayer* #3's date** — 2021-02-09 is probably 2022-02-09.
- [ ] **11. Check the *Dynamite* publisher** on the "Angel" #1–2 and "Buffy the Vampire Slayer" #1–3
  comics. Those series were published by Dark Horse / IDW / Boom!, so it may be a data error.
  (Item 3 would match them by date anyway.)
