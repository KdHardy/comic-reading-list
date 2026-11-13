import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const pullList = read('0011_pull_list.sql');
const stuart = read('0012_stuart_metadata.sql');
const aliasesAndSkips = read('0014_stuart_aliases_and_skips.sql');

const baseSchema = `
  create role anon;
  create role authenticated;
  create role service_role;

  create table public.book (
    book_id serial primary key,
    publisher text,
    series text not null,
    volume text,
    number text,
    publish_date date,
    completed boolean not null default false,
    unique (series, volume, number, publisher)
  );

  create table public.app_secret (
    singleton boolean primary key default true,
    secret text not null
  );

  create or replace function public._check_secret(p_secret text)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if p_secret is distinct from 'test-secret' then
      raise exception 'unauthorized';
    end if;
  end;
  $$;

  insert into app_secret(secret) values ('test-secret');
  insert into book(book_id, publisher, series, volume, number, publish_date) values
    (1, 'DC Comics', 'Catwoman', null, '31', '2021-05-18'),
    (2, 'DC Comics', 'Catwoman', null, '32', '2021-06-15'),
    (3, null,        'The Sandman', null, '70', null),
    (4, 'Vertigo',   'The Sandman', null, '70', null),
    (5, 'Marvel',    'Silk', null, '3', '2021-05-12');
  select setval('book_book_id_seq', 5, true);
`;

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function testStuartMigration() {
  const db = new PGlite();
  await db.exec(baseSchema);
  await db.exec(pullList);
  await db.exec(stuart);
  await db.exec(stuart); // idempotent

  // Existing books start out pending.
  assert.equal(await scalar(db, `select public.stuart_pending_count()`), 5);
  const pending = await db.query(`select book_id from stuart_pending_books(2)`);
  assert.deepEqual(pending.rows.map((r) => r.book_id), [1, 2]);

  // The user's Pull List choices for the old key carry over to the canonical key.
  await db.query(`select set_pull_list_series_status('test-secret', 'Catwoman', '', 'DC Comics', 'read_all')`);
  await db.query(`select set_pull_list_series_family('test-secret', 'Catwoman', '', 'DC Comics', 'Bat-Family')`);

  const svId = await scalar(db, `select stuart_upsert_series_volume($1::jsonb)`, [
    JSON.stringify({
      source: 'comicvine', source_id: '200', name: 'Catwoman', start_year: 2018, publisher: 'DC Comics',
      count_of_issues: 70, last_issue_number: '70', last_issue_date: '2026-10-20', is_ongoing: true, site_url: 'cv/200',
    }),
  ]);
  // Upserting again updates in place.
  const svAgain = await scalar(db, `select stuart_upsert_series_volume($1::jsonb)`, [
    JSON.stringify({ source: 'comicvine', source_id: '200', name: 'Catwoman', start_year: 2018, publisher: 'DC Comics', count_of_issues: 71 }),
  ]);
  assert.equal(svAgain, svId);
  assert.equal(await scalar(db, `select count_of_issues from series_volume`), 71);

  const arcs = JSON.stringify([{ source_id: '9', name: 'Fear State', publisher: 'DC Comics', issue_count: 60 }]);
  await db.query(`select stuart_apply_book_match(1, $1, '31', '2021-05-18', $2::jsonb)`, [svId, arcs]);

  const book1 = await db.query(`select scan_state, series_volume_id, source_issue_id, series, volume, publisher from book where book_id = 1`);
  assert.deepEqual(book1.rows[0], {
    scan_state: 'matched', series_volume_id: svId, source_issue_id: '31',
    series: 'Catwoman', volume: null, publisher: 'DC Comics', // user's own text untouched
  });
  assert.deepEqual(
    (await db.query(`select s.name, s.issue_count from book_storyline bs join storyline s using (storyline_id) where bs.book_id = 1`)).rows,
    [{ name: 'Fear State', issue_count: 60 }]
  );
  assert.deepEqual(
    (await db.query(`select * from book_pull_list_key(1)`)).rows,
    [{ series: 'Catwoman', volume: '2018', publisher: 'DC Comics' }]
  );
  assert.deepEqual(
    (await db.query(`select family, status from pull_list_series where series = 'Catwoman' and volume = '2018'`)).rows,
    [{ family: 'Bat-Family', status: 'read_all' }]
  );

  // Title art accepts a cover that sits under the canonical key.
  await db.query(`select set_pull_list_series_title_art('test-secret', 'Catwoman', '2018', 'DC Comics', 1, 0, 0, 1, 0.25)`);
  await assert.rejects(
    () => db.query(`select set_pull_list_series_title_art('test-secret', 'Catwoman', '2018', 'DC Comics', 2, 0, 0, 1, 0.25)`),
    /not part of this series/
  );

  // Known volume lookup by the user's own key.
  assert.deepEqual(
    (await db.query(`select source, source_id from stuart_known_volume('Catwoman', '', 'DC Comics')`)).rows,
    [{ source: 'comicvine', source_id: '200' }]
  );

  // No issue id: the volume is linked but the book is checked again in 30 days.
  await db.query(`select stuart_apply_book_match(2, $1, null, null, '[]'::jsonb)`, [svId]);
  const book2 = await db.query(`select scan_state, series_volume_id, next_scan_after > now() + interval '29 days' as later from book where book_id = 2`);
  assert.deepEqual(book2.rows[0], { scan_state: 'pending', series_volume_id: svId, later: true });
  assert.equal(await scalar(db, `select count(*)::int from stuart_pending_books(100) where book_id = 2`), 0);

  // Filling a blank publisher is skipped when it would collide with another book.
  const sandman = await scalar(db, `select stuart_upsert_series_volume($1::jsonb)`, [
    JSON.stringify({ source: 'comicvine', source_id: '300', name: 'The Sandman', start_year: 1989, publisher: 'Vertigo' }),
  ]);
  await db.query(`select stuart_apply_book_match(3, $1, '70', '1995-03-01', '[]'::jsonb)`, [sandman]);
  assert.deepEqual(
    (await db.query(`select publisher, publish_date::text, scan_state from book where book_id = 3`)).rows[0],
    { publisher: null, publish_date: '1995-03-01', scan_state: 'matched' }
  );

  // Stuart's own writes don't re-queue the book; the user's edits do.
  await db.query(`update book set completed = true where book_id = 1`);
  assert.equal(await scalar(db, `select scan_state from book where book_id = 1`), 'matched');
  await db.query(`update book set number = '33' where book_id = 1`);
  assert.equal(await scalar(db, `select scan_state from book where book_id = 1`), 'pending');

  // Failures: errors recorded, book parked for a week, previous errors cleared.
  const runId = await scalar(db, `insert into stuart_run(trigger) values ('nightly') returning run_id`);
  const errors = JSON.stringify([
    { adapter: 'comicvine', code: 'no_date_match', message: 'No match', details: { candidates: [] } },
  ]);
  await db.query(`select stuart_record_book_failure($1, 5, $2::jsonb)`, [runId, errors]);
  await db.query(`select stuart_record_book_failure($1, 5, $2::jsonb)`, [runId, errors]);
  const book5 = await db.query(`select scan_state, scan_attempts, next_scan_after > now() + interval '6 days' as parked from book where book_id = 5`);
  assert.deepEqual(book5.rows[0], { scan_state: 'failed', scan_attempts: 2, parked: true });
  assert.deepEqual(
    (await db.query(`select series, number, code, cleared_at is null as open from stuart_scan_error order by error_id`)).rows,
    [
      { series: 'Silk', number: '3', code: 'no_date_match', open: false },
      { series: 'Silk', number: '3', code: 'no_date_match', open: true },
    ]
  );
  assert.equal(await scalar(db, `select count(*)::int from stuart_pending_books(100) where book_id = 5`), 0);

  // A later match clears the open error.
  await db.query(`update book set next_scan_after = now() - interval '1 minute' where book_id = 5`);
  assert.equal(await scalar(db, `select count(*)::int from stuart_pending_books(100) where book_id = 5`), 1);
  const silk = await scalar(db, `select stuart_upsert_series_volume($1::jsonb)`, [
    JSON.stringify({ source: 'comicvine', source_id: '400', name: 'Silk', start_year: 2021, publisher: 'Marvel' }),
  ]);
  await db.query(`select stuart_apply_book_match(5, $1, '3', null, '[]'::jsonb)`, [silk]);
  assert.equal(await scalar(db, `select count(*)::int from stuart_scan_error where cleared_at is null`), 0);

  // After 3 failed attempts a book is no longer retried automatically.
  await db.query(`update book set scan_state = 'failed', scan_attempts = 3, next_scan_after = now() - interval '1 day' where book_id = 5`);
  assert.equal(await scalar(db, `select count(*)::int from stuart_pending_books(100) where book_id = 5`), 0);

  // 0014: aliases and skipped books.
  await db.exec(aliasesAndSkips);
  await db.exec(aliasesAndSkips); // idempotent
  assert.deepEqual(
    (await db.query(`select alias, title, start_year, publisher from stuart_series_alias`)).rows,
    [{ alias: 'Buffy Classic', title: 'Buffy the Vampire Slayer', start_year: 1998, publisher: 'Dark Horse Comics' }]
  );
  await db.query(`insert into book(book_id, series, publisher, publish_date) values (20, 'Buffy Season 9 short', 'Dark Horse Comics', '2011-08-01')`);
  const shortRun = await scalar(db, `insert into stuart_run(trigger) values ('nightly') returning run_id`);
  await db.query(`select stuart_record_book_failure($1, 20, $2::jsonb)`, [
    shortRun,
    JSON.stringify([{ adapter: 'comicvine', code: 'no_candidates', message: 'nope' }]),
  ]);
  await db.query(`select stuart_skip_book(20, 'short: not a standalone issue')`);
  assert.equal(await scalar(db, `select scan_state from book where book_id = 20`), 'skipped');
  assert.equal(await scalar(db, `select count(*)::int from stuart_scan_error where book_id = 20 and cleared_at is null`), 0);
  assert.equal(await scalar(db, `select count(*)::int from stuart_pending_books(100) where book_id = 20`), 0);
  // Editing a skipped book queues it again.
  await db.query(`update book set series = 'Buffy Season 9' where book_id = 20`);
  assert.equal(await scalar(db, `select scan_state from book where book_id = 20`), 'pending');
  assert.equal(
    await scalar(db, `select has_function_privilege('anon', 'public.stuart_skip_book(integer,text)', 'EXECUTE')`),
    false
  );

  // Deleting a series_volume unlinks books rather than deleting them.
  await db.query(`delete from series_volume where series_volume_id = $1`, [silk]);
  assert.equal(await scalar(db, `select series_volume_id from book where book_id = 5`), null);

  // The REST roles can read the new tables but not write them, nor call Stuart's writers.
  const privileges = await db.query(`
    select
      has_table_privilege('anon', 'public.series_volume', 'SELECT') as read_sv,
      has_table_privilege('anon', 'public.series_volume', 'INSERT') as write_sv,
      has_table_privilege('anon', 'public.stuart_config', 'SELECT') as read_config,
      has_function_privilege('anon', 'public.stuart_apply_book_match(integer,bigint,text,date,jsonb)', 'EXECUTE') as apply,
      has_function_privilege('service_role', 'public.stuart_apply_book_match(integer,bigint,text,date,jsonb)', 'EXECUTE') as service_apply
  `);
  assert.deepEqual(privileges.rows[0], {
    read_sv: true, write_sv: false, read_config: false, apply: false, service_apply: true,
  });

  await db.close();
}

await testStuartMigration();
console.log('stuart migration tests passed');
