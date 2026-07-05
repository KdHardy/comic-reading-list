-- Comic Reading List — initial schema
-- Tables: location, reading_list, book, reading_order
-- See /README.md and the project plan for the full design rationale.

create table if not exists location (
    location_id   serial primary key,
    location_name text not null unique
);

insert into location (location_name) values
    ('Local'),
    ('Marvel Unlimited'),
    ('DC Universe Infinite'),
    ('Hoopla'),
    ('Comixology')
on conflict (location_name) do nothing;

create table if not exists reading_list (
    list_id         serial primary key,
    list_name       text not null check (btrim(list_name) <> ''),
    completed       boolean not null default false,
    created_date    timestamptz not null default now(),
    completed_date  timestamptz
);

create table if not exists book (
    book_id         serial primary key,
    publisher       text,
    series          text not null,
    volume          text,
    number          text,
    event           text,
    publish_date    date,
    thumbnail       text,
    location1_id    integer references location (location_id),
    location2_id    integer references location (location_id),
    location3_id    integer references location (location_id),
    completed       boolean not null default false,
    completed_date  timestamptz,
    -- Dedupe key used by add_book_to_list's find-or-create logic.
    -- Note: Postgres treats NULLs as distinct, so two books that differ only
    -- by a NULL volume/number won't collide here — acceptable for this app's scale.
    unique (series, volume, number, publisher)
);

create table if not exists reading_order (
    list_id     integer not null references reading_list (list_id) on delete cascade,
    book_id     integer not null references book (book_id) on delete cascade,
    read_order  integer not null,
    primary key (list_id, book_id)
);

create index if not exists idx_reading_order_list on reading_order (list_id, read_order);

-- Single-row table holding the shared write secret checked by every mutating
-- RPC function (see 0002_functions.sql). Never exposed via the REST API —
-- no RLS policy grants access to it, so it's unreachable via PostgREST.
create table if not exists app_secret (
    singleton   boolean primary key default true check (singleton),
    secret      text not null
);

comment on table app_secret is
    'Holds the one shared secret the browser extension and web app send with every write. Rotate by updating this row.';
