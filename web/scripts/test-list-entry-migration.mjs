import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../../supabase/migrations/0010_restore_list_entry_canonical.sql', import.meta.url),
  'utf8'
);
const verification = readFileSync(
  new URL('../../supabase/verify_list_entry_recovery.sql', import.meta.url),
  'utf8'
);

const baseSchema = `
  create role anon;
  create role authenticated;
  create role service_role;

  create table public.reading_list (
    list_id serial primary key,
    list_name text not null,
    completed boolean not null default false,
    created_date timestamptz not null default now(),
    completed_date timestamptz
  );

  create table public.book (
    book_id serial primary key,
    publisher text,
    series text not null,
    volume text,
    number text,
    event text,
    publish_date date,
    thumbnail text,
    completed boolean not null default false,
    completed_date timestamptz,
    location1_id integer,
    location2_id integer,
    location3_id integer
  );

  create table public.app_secret (
    singleton boolean primary key default true,
    secret text not null
  );

  create table public.reading_order (
    list_id integer not null references reading_list(list_id) on delete cascade,
    book_id integer not null references book(book_id) on delete cascade,
    read_order integer not null,
    primary key (list_id, book_id)
  );

  create or replace function public._check_secret(p_secret text)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if p_secret <> 'test-secret' then
      raise exception 'unauthorized';
    end if;
  end;
  $$;

  insert into app_secret(secret) values ('test-secret');
  insert into reading_list(list_id, list_name) values (6, 'Source'), (7, 'Target');
  select setval('reading_list_list_id_seq', 7, true);
  insert into book(book_id, series, completed, completed_date) values
    (1, 'One', true, '2026-09-15'),
    (2, 'Two', false, null),
    (3, 'Three', false, null),
    (4, 'Four', false, null);
  select setval('book_book_id_seq', 4, true);
`;

async function testExistingCanonicalSchema() {
  const db = new PGlite();
  await db.exec(`${baseSchema}
    create table public.list_entry (
      entry_id serial primary key,
      list_id integer not null references reading_list(list_id) on delete cascade,
      entry_type text not null,
      book_id integer references book(book_id) on delete cascade,
      divider_name text,
      read_order integer not null
    );
    insert into list_entry(
      entry_id,
      list_id,
      entry_type,
      book_id,
      divider_name,
      read_order
    ) values
      (10, 6, 'book', 1, null, 10),
      (11, 6, 'divider', null, 'Section', 20),
      (12, 6, 'book', 2, null, 30),
      (13, 7, 'book', 3, null, 40),
      (100, 6, 'divider', null, 'Deleted high ID', 1000);
    delete from list_entry where entry_id = 100;
    select setval('list_entry_entry_id_seq', 100, true);
    insert into reading_order(list_id, book_id, read_order) values (7, 3, 40);
  `);

  await db.exec(migration);
  await db.exec(migration);
  await db.exec(verification);

  const backfilled = await db.query(`
    select entry_id, book_id, read_order
    from list_entry
    where list_id = 7 and entry_type = 'book'
  `);
  assert.equal(backfilled.rows.length, 1);
  assert.equal(backfilled.rows[0].book_id, 3);
  const bookEntryId = backfilled.rows[0].entry_id;

  const mirror = await db.query(`
    select count(*)::integer as count
    from reading_order
    where list_id = 6
  `);
  assert.equal(mirror.rows[0].count, 2);

  await db.query(`
    select reorder_list(
      'test-secret',
      6,
      array[2, 1]::integer[]
    )
  `);
  const legacyOrder = await db.query(`
    select entry_type, book_id, read_order
    from list_entry
    where list_id = 6
    order by read_order, entry_id
  `);
  assert.deepEqual(
    legacyOrder.rows,
    [
      { entry_type: 'book', book_id: 2, read_order: 10 },
      { entry_type: 'divider', book_id: null, read_order: 20 },
      { entry_type: 'book', book_id: 1, read_order: 30 },
    ]
  );

  const created = await db.query(`
    select create_section_divider_v2(
      'test-secret',
      7,
      'Finale',
      null
    ) as id
  `);
  const dividerId = created.rows[0].id;
  assert.ok(dividerId > 100);
  await db.query(
    `select update_section_divider_v2('test-secret', $1, 'Finale Updated')`,
    [dividerId]
  );
  await db.query(
    `select reorder_list_entries_v2('test-secret', 7, $1::integer[])`,
    [[dividerId, bookEntryId]]
  );

  const snapshot = {
    list_name: 'Target',
    books: [{
      entry_id: bookEntryId,
      book_id: 3,
      read_order: 20,
      completed: false,
      completed_date: null,
      location1_id: null,
      location2_id: null,
      location3_id: null,
    }],
    dividers: [{
      entry_id: dividerId,
      divider_name: 'Finale Updated',
      read_order: 10,
    }],
  };

  await db.query(`select delete_list_entry_v2('test-secret', 7, $1)`, [dividerId]);
  await db.query(`select delete_list_entry_v2('test-secret', 7, $1)`, [bookEntryId]);
  await db.query(
    `select revert_list_entries_v2('test-secret', 7, $1::jsonb)`,
    [JSON.stringify(snapshot)]
  );

  const restored = await db.query(`
    select entry_id, entry_type
    from list_entry
    where list_id = 7
    order by read_order
  `);
  assert.deepEqual(
    restored.rows,
    [
      { entry_id: dividerId, entry_type: 'divider' },
      { entry_id: bookEntryId, entry_type: 'book' },
    ]
  );

  await db.query(`
    select add_book_to_list(
      'test-secret',
      6,
      'Four',
      null,
      null,
      null,
      null,
      null,
      null
    )
  `);
  const mirrored = await db.query(`
    select count(*)::integer as count
    from list_entry
    join reading_order using (list_id, book_id)
    where list_entry.list_id = 6 and list_entry.book_id = 4
  `);
  assert.equal(mirrored.rows[0].count, 1);

  const legacySnapshot = {
    list_name: 'Source',
    books: [
      {
        book_id: 2,
        read_order: 10,
        completed: false,
        completed_date: null,
        location1_id: null,
        location2_id: null,
        location3_id: null,
      },
      {
        book_id: 1,
        read_order: 30,
        completed: true,
        completed_date: '2026-09-15T00:00:00Z',
        location1_id: null,
        location2_id: null,
        location3_id: null,
      },
    ],
  };
  await db.query(
    `select revert_list('test-secret', 6, $1::jsonb)`,
    [JSON.stringify(legacySnapshot)]
  );
  const afterLegacyRevert = await db.query(`
    select
      count(*) filter (where entry_type = 'book')::integer as books,
      count(*) filter (where entry_type = 'divider')::integer as dividers
    from list_entry
    where list_id = 6
  `);
  assert.deepEqual(afterLegacyRevert.rows, [{ books: 3, dividers: 1 }]);

  await db.query(`select remove_book_from_list('test-secret', 6, 4)`);
  const preserved = await db.query(`
    select
      count(*) filter (where entry_type = 'book')::integer as books,
      count(*) filter (where entry_type = 'divider')::integer as dividers
    from list_entry
    where list_id = 6
  `);
  assert.deepEqual(preserved.rows, [{ books: 2, dividers: 1 }]);

  await db.close();
}

async function testFreshSchema() {
  const db = new PGlite();
  await db.exec(`${baseSchema}
    insert into reading_order(list_id, book_id, read_order) values
      (6, 1, 10),
      (6, 2, 20);
  `);

  await db.exec(migration);
  await db.exec(migration);
  await db.exec(verification);

  const entries = await db.query(`
    select entry_type, book_id, read_order
    from list_entry
    where list_id = 6
    order by read_order
  `);
  assert.deepEqual(
    entries.rows,
    [
      { entry_type: 'book', book_id: 1, read_order: 10 },
      { entry_type: 'book', book_id: 2, read_order: 20 },
    ]
  );

  await db.close();
}

await testExistingCanonicalSchema();
await testFreshSchema();
console.log('list_entry migration compatibility tests passed');
