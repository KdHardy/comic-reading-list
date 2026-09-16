-- Targeted repair for a missing public.reading_order relation.
--
-- This intentionally does not replay 0001_init_schema.sql or any seed data.
-- It is safe to run more than once and preserves an existing reading_order
-- table and its rows when the relation is already present.

begin;

do $$
begin
    if to_regclass('public.reading_list') is null
       or to_regclass('public.book') is null
       or to_regclass('public.app_secret') is null then
        raise exception
            'reading_order repair requires public.reading_list, public.book, and public.app_secret';
    end if;
end;
$$;

create table if not exists public.reading_order (
    list_id     integer not null references public.reading_list (list_id) on delete cascade,
    book_id     integer not null references public.book (book_id) on delete cascade,
    read_order  integer not null,
    primary key (list_id, book_id)
);

create index if not exists idx_reading_order_list
    on public.reading_order (list_id, read_order);

alter table public.reading_order enable row level security;

-- Direct REST access is read-only. Mutations continue to use SECURITY DEFINER
-- RPCs guarded by _check_secret.
revoke insert, update, delete, truncate, references, trigger
    on table public.reading_order from anon, authenticated;
grant select on table public.reading_order to anon, authenticated;
grant all on table public.reading_order to service_role;

drop policy if exists "public read access" on public.reading_order;
create policy "public read access"
    on public.reading_order
    for select
    to anon, authenticated
    using (true);

-- Shared authorization dependency for all repaired write RPCs.
create or replace function public._check_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_secret is null
       or not exists (select 1 from app_secret where secret = p_secret) then
        raise exception 'unauthorized' using errcode = '28000';
    end if;
end;
$$;

-- Latest definition from 0006_update_thumbnail_on_readd.sql.
create or replace function public.add_book_to_list(
    p_secret        text,
    p_list_id       integer,
    p_series        text,
    p_publisher     text default null,
    p_volume        text default null,
    p_number        text default null,
    p_event         text default null,
    p_publish_date  date default null,
    p_thumbnail     text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_book_id     integer;
    v_next_order  integer;
begin
    perform _check_secret(p_secret);

    if not exists (select 1 from reading_list where list_id = p_list_id) then
        raise exception 'list % not found', p_list_id;
    end if;

    select book_id into v_book_id
    from book
    where series = p_series
      and coalesce(volume, '') = coalesce(p_volume, '')
      and coalesce(number, '') = coalesce(p_number, '')
      and coalesce(publisher, '') = coalesce(p_publisher, '');

    if v_book_id is null then
        insert into book (series, volume, number, publisher, event, publish_date, thumbnail)
        values (p_series, p_volume, p_number, p_publisher, p_event, p_publish_date, p_thumbnail)
        returning book_id into v_book_id;
    elsif p_thumbnail is not null then
        update book set thumbnail = p_thumbnail where book_id = v_book_id;
    end if;

    select coalesce(max(read_order), 0) + 10 into v_next_order
    from reading_order
    where list_id = p_list_id;

    insert into reading_order (list_id, book_id, read_order)
    values (p_list_id, v_book_id, v_next_order)
    on conflict (list_id, book_id) do nothing;

    return v_book_id;
end;
$$;

-- Latest definition from 0002_functions.sql.
create or replace function public.reorder_list(
    p_secret text,
    p_list_id integer,
    p_book_ids integer[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_book_id integer;
    v_order   integer := 10;
begin
    perform _check_secret(p_secret);

    foreach v_book_id in array p_book_ids
    loop
        update reading_order
        set read_order = v_order
        where list_id = p_list_id and book_id = v_book_id;

        v_order := v_order + 10;
    end loop;
end;
$$;

-- Latest definitions from 0004_remove_book_from_list.sql.
create or replace function public.remove_book_from_list(
    p_secret text,
    p_list_id integer,
    p_book_id integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform _check_secret(p_secret);

    delete from reading_order
    where list_id = p_list_id and book_id = p_book_id;
end;
$$;

create or replace function public.revert_list(
    p_secret text,
    p_list_id integer,
    p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item jsonb;
begin
    perform _check_secret(p_secret);

    if p_snapshot ? 'list_name' then
        update reading_list
        set list_name = p_snapshot->>'list_name'
        where list_id = p_list_id;
    end if;

    for v_item in select jsonb_array_elements(p_snapshot->'books')
    loop
        update book
        set completed      = (v_item->>'completed')::boolean,
            completed_date = case when (v_item->>'completed')::boolean
                                   then (v_item->>'completed_date')::timestamptz
                                   else null end,
            location1_id   = (v_item->>'location1_id')::integer,
            location2_id   = (v_item->>'location2_id')::integer,
            location3_id   = (v_item->>'location3_id')::integer
        where book_id = (v_item->>'book_id')::integer;

        insert into reading_order (list_id, book_id, read_order)
        values (
            p_list_id,
            (v_item->>'book_id')::integer,
            (v_item->>'read_order')::integer
        )
        on conflict (list_id, book_id)
        do update set read_order = excluded.read_order;
    end loop;
end;
$$;

revoke all on function
    public.add_book_to_list(text, integer, text, text, text, text, text, date, text),
    public.reorder_list(text, integer, integer[]),
    public.remove_book_from_list(text, integer, integer),
    public.revert_list(text, integer, jsonb)
from public;

grant execute on function
    public.add_book_to_list(text, integer, text, text, text, text, text, date, text),
    public.reorder_list(text, integer, integer[]),
    public.remove_book_from_list(text, integer, integer),
    public.revert_list(text, integer, jsonb)
to anon, authenticated;

-- Make the restored relation visible through PostgREST immediately after commit.
notify pgrst, 'reload schema';

commit;
