import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../../supabase/migrations/0011_pull_list.sql', import.meta.url),
  'utf8'
);

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
    completed boolean not null default false
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
  insert into book(book_id, publisher, series, volume, number) values
    (1, 'Marvel', 'X-Men', '2021', '1'),
    (2, 'Marvel', 'X-Men', '2021', '2'),
    (3, null, 'Indie', null, '1'),
    (4, 'Marvel', 'X-Factor', '2020', '1');
`;

async function rejects(db, sql, params, pattern) {
  await assert.rejects(() => db.query(sql, params), pattern);
}

async function testPullListMigration() {
  const db = new PGlite();
  await db.exec(baseSchema);
  await db.exec(migration);
  // Idempotent: running twice must not fail.
  await db.exec(migration);

  await db.query(
    `select set_pull_list_series_status('test-secret', 'X-Men', '2021', 'Marvel', 'read_all')`
  );
  await db.query(
    `select set_pull_list_series_family('test-secret', 'X-Men', '2021', 'Marvel', '  X-Men  ')`
  );
  await db.query(
    `select set_pull_list_series_title_art('test-secret', 'X-Men', '2021', 'Marvel', 2, 0, 0.05, 1, 0.2)`
  );

  const xmen = await db.query(`
    select family, status, title_art_book_id, title_art_y::numeric(4, 2) as y
    from pull_list_series
    where series = 'X-Men'
  `);
  assert.deepEqual(xmen.rows, [{ family: 'X-Men', status: 'read_all', title_art_book_id: 2, y: '0.05' }]);

  // NULL volume/publisher normalize to '' so edits land on one row.
  await db.query(`select set_pull_list_series_status('test-secret', 'Indie', null, null, 'maybe')`);
  await db.query(`select set_pull_list_series_family('test-secret', 'Indie', '', '', 'Small press')`);
  const indie = await db.query(`
    select volume, publisher, family, status from pull_list_series where series = 'Indie'
  `);
  assert.deepEqual(indie.rows, [{ volume: '', publisher: '', family: 'Small press', status: 'maybe' }]);

  // Ordering creates rows for untouched series and assigns gapped sort orders.
  await db.query(`select reorder_pull_list_series('test-secret', $1::jsonb)`, [
    JSON.stringify([
      { series: 'Indie', volume: '', publisher: '' },
      { series: 'X-Factor', volume: '2020', publisher: 'Marvel' },
      { series: 'X-Men', volume: '2021', publisher: 'Marvel' },
    ]),
  ]);
  const order = await db.query(`
    select series, sort_order from pull_list_series order by sort_order
  `);
  assert.deepEqual(order.rows, [
    { series: 'Indie', sort_order: 10 },
    { series: 'X-Factor', sort_order: 20 },
    { series: 'X-Men', sort_order: 30 },
  ]);

  // Clearing the status and the title art.
  await db.query(`select set_pull_list_series_status('test-secret', 'X-Men', '2021', 'Marvel', null)`);
  await db.query(
    `select set_pull_list_series_title_art('test-secret', 'X-Men', '2021', 'Marvel', null, 0, 0, 1, 1)`
  );
  const cleared = await db.query(`
    select status, title_art_book_id, title_art_x from pull_list_series where series = 'X-Men'
  `);
  assert.deepEqual(cleared.rows, [{ status: null, title_art_book_id: null, title_art_x: null }]);

  // Deleting the cover book clears the reference rather than the series row.
  await db.query(
    `select set_pull_list_series_title_art('test-secret', 'X-Men', '2021', 'Marvel', 1, 0, 0, 1, 0.25)`
  );
  await db.query(`delete from book where book_id = 1`);
  const afterDelete = await db.query(`select title_art_book_id from pull_list_series where series = 'X-Men'`);
  assert.equal(afterDelete.rows[0].title_art_book_id, null);

  await rejects(
    db,
    `select set_pull_list_series_status('wrong', 'X-Men', '2021', 'Marvel', 'skip')`,
    [],
    /unauthorized/
  );
  await rejects(
    db,
    `select set_pull_list_series_status('test-secret', 'X-Men', '2021', 'Marvel', 'later')`,
    [],
    /invalid pull list status/
  );
  await rejects(
    db,
    `select set_pull_list_series_title_art('test-secret', 'X-Men', '2021', 'Marvel', 4, 0, 0, 1, 0.2)`,
    [],
    /not part of this series/
  );
  await rejects(
    db,
    `select set_pull_list_series_title_art('test-secret', 'X-Men', '2021', 'Marvel', 2, 0.5, 0, 0.8, 0.2)`,
    [],
    /pull_list_series_crop_check/
  );
  await rejects(
    db,
    `select set_pull_list_series_family('test-secret', '  ', '', '', 'Nope')`,
    [],
    /series cannot be blank/
  );

  await db.close();
}

await testPullListMigration();
console.log('pull list migration tests passed');
