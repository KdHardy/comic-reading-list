-- Restore mixed book/divider entries while keeping reading_order as a
-- compatibility mirror during the frontend cutover.
--
-- list_entry is canonical. This migration is transactional and idempotent:
-- existing entry IDs and divider rows are preserved, and only book memberships
-- missing from list_entry are backfilled from reading_order.

begin;

create table if not exists public.list_entry (
    entry_id      serial primary key,
    list_id       integer not null references public.reading_list (list_id) on delete cascade,
    entry_type    text not null check (entry_type in ('book', 'divider')),
    book_id       integer references public.book (book_id) on delete cascade,
    divider_name  text,
    read_order    integer not null,
    constraint list_entry_shape_check check (
        (
            entry_type = 'book'
            and book_id is not null
            and divider_name is null
        )
        or
        (
            entry_type = 'divider'
            and book_id is null
            and btrim(coalesce(divider_name, '')) <> ''
        )
    )
);

create index if not exists idx_list_entry_order
    on public.list_entry (list_id, read_order, entry_id);

create unique index if not exists idx_list_entry_unique_book
    on public.list_entry (list_id, book_id)
    where entry_type = 'book';

alter table public.list_entry enable row level security;

revoke insert, update, delete, truncate, references, trigger
    on table public.list_entry from anon, authenticated;
grant select on table public.list_entry to anon, authenticated;
grant all on table public.list_entry to service_role;

drop policy if exists "public read access" on public.list_entry;
create policy "public read access"
    on public.list_entry
    for select
    to anon, authenticated
    using (true);

insert into public.list_entry (
    list_id,
    entry_type,
    book_id,
    divider_name,
    read_order
)
select
    reading_order.list_id,
    'book',
    reading_order.book_id,
    null,
    reading_order.read_order
from public.reading_order
where not exists (
    select 1
    from public.list_entry
    where list_entry.list_id = reading_order.list_id
      and list_entry.entry_type = 'book'
      and list_entry.book_id = reading_order.book_id
);

-- Populate/update the compatibility mirror from every canonical book entry so
-- the preceding book-only frontend remains readable until its deployment.
insert into public.reading_order (list_id, book_id, read_order)
select list_id, book_id, read_order
from public.list_entry
where entry_type = 'book'
on conflict (list_id, book_id)
do update set read_order = excluded.read_order;

-- Keep the entry sequence ahead of preserved production entry IDs.
do $$
declare
    v_sequence text := pg_get_serial_sequence('public.list_entry', 'entry_id');
    v_max_id bigint;
    v_last_value bigint;
begin
    if v_sequence is not null then
        select max(entry_id) into v_max_id from public.list_entry;
        execute format('select last_value from %s', v_sequence::regclass)
        into v_last_value;
        if v_max_id is not null and v_max_id > v_last_value then
            perform setval(v_sequence, v_max_id, true);
        end if;
    end if;
end;
$$;

-- Add or refresh a book in the canonical table and compatibility mirror.
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
    v_book_id integer;
    v_read_order integer;
begin
    perform _check_secret(p_secret);

    perform 1
    from reading_list
    where list_id = p_list_id
    for update;
    if not found then
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
        values (
            p_series,
            p_volume,
            p_number,
            p_publisher,
            p_event,
            p_publish_date,
            p_thumbnail
        )
        returning book_id into v_book_id;
    elsif p_thumbnail is not null then
        update book set thumbnail = p_thumbnail where book_id = v_book_id;
    end if;

    select read_order into v_read_order
    from list_entry
    where list_id = p_list_id
      and entry_type = 'book'
      and book_id = v_book_id;

    if v_read_order is null then
        select coalesce(max(read_order), 0) + 10
        into v_read_order
        from list_entry
        where list_id = p_list_id;

        insert into list_entry (
            list_id,
            entry_type,
            book_id,
            divider_name,
            read_order
        )
        values (p_list_id, 'book', v_book_id, null, v_read_order);
    end if;

    insert into reading_order (list_id, book_id, read_order)
    values (p_list_id, v_book_id, v_read_order)
    on conflict (list_id, book_id)
    do update set read_order = excluded.read_order;

    return v_book_id;
end;
$$;

create or replace function public.create_section_divider_v2(
    p_secret text,
    p_list_id integer,
    p_divider_name text,
    p_before_entry_id integer default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entry_id integer;
    v_read_order integer;
begin
    perform _check_secret(p_secret);

    if btrim(coalesce(p_divider_name, '')) = '' then
        raise exception 'divider name cannot be blank';
    end if;

    perform 1
    from reading_list
    where list_id = p_list_id
    for update;
    if not found then
        raise exception 'list % not found', p_list_id;
    end if;

    if p_before_entry_id is null then
        select coalesce(max(read_order), 0) + 10
        into v_read_order
        from list_entry
        where list_id = p_list_id;
    else
        select read_order into v_read_order
        from list_entry
        where list_id = p_list_id
          and entry_id = p_before_entry_id;
        if not found then
            raise exception 'entry % not found in list %', p_before_entry_id, p_list_id;
        end if;

        update list_entry
        set read_order = read_order + 10
        where list_id = p_list_id
          and read_order >= v_read_order;
    end if;

    insert into list_entry (
        list_id,
        entry_type,
        book_id,
        divider_name,
        read_order
    )
    values (
        p_list_id,
        'divider',
        null,
        btrim(p_divider_name),
        v_read_order
    )
    returning entry_id into v_entry_id;

    update reading_order
    set read_order = list_entry.read_order
    from list_entry
    where reading_order.list_id = p_list_id
      and list_entry.list_id = p_list_id
      and list_entry.entry_type = 'book'
      and reading_order.book_id = list_entry.book_id;

    return v_entry_id;
end;
$$;

create or replace function public.update_section_divider_v2(
    p_secret text,
    p_divider_id integer,
    p_divider_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform _check_secret(p_secret);

    if btrim(coalesce(p_divider_name, '')) = '' then
        raise exception 'divider name cannot be blank';
    end if;

    update list_entry
    set divider_name = btrim(p_divider_name)
    where entry_id = p_divider_id
      and entry_type = 'divider';

    if not found then
        raise exception 'divider % not found', p_divider_id;
    end if;
end;
$$;

create or replace function public.delete_list_entry_v2(
    p_secret text,
    p_list_id integer,
    p_entry_id integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_book_id integer;
begin
    perform _check_secret(p_secret);

    perform 1
    from reading_list
    where list_id = p_list_id
    for update;
    if not found then
        raise exception 'list % not found', p_list_id;
    end if;

    delete from list_entry
    where list_id = p_list_id
      and entry_id = p_entry_id
    returning book_id into v_book_id;

    if not found then
        raise exception 'entry % not found in list %', p_entry_id, p_list_id;
    end if;

    if v_book_id is not null then
        delete from reading_order
        where list_id = p_list_id
          and book_id = v_book_id;
    end if;
end;
$$;

create or replace function public.reorder_list_entries_v2(
    p_secret text,
    p_list_id integer,
    p_entry_ids integer[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entry_id integer;
    v_expected_count integer;
    v_order integer := 10;
begin
    perform _check_secret(p_secret);

    perform 1
    from reading_list
    where list_id = p_list_id
    for update;
    if not found then
        raise exception 'list % not found', p_list_id;
    end if;

    select count(*) into v_expected_count
    from list_entry
    where list_id = p_list_id;

    if coalesce(cardinality(p_entry_ids), 0) <> v_expected_count
       or (
           select count(distinct entry_id)
           from unnest(coalesce(p_entry_ids, array[]::integer[])) as entry_id
       ) <> v_expected_count
       or exists (
           select 1
           from unnest(coalesce(p_entry_ids, array[]::integer[])) as requested(entry_id)
           where not exists (
               select 1
               from list_entry
               where list_entry.list_id = p_list_id
                 and list_entry.entry_id = requested.entry_id
           )
       ) then
        raise exception 'entry order must contain every list entry exactly once';
    end if;

    foreach v_entry_id in array coalesce(p_entry_ids, array[]::integer[])
    loop
        update list_entry
        set read_order = v_order
        where list_id = p_list_id
          and entry_id = v_entry_id;
        v_order := v_order + 10;
    end loop;

    update reading_order
    set read_order = list_entry.read_order
    from list_entry
    where reading_order.list_id = p_list_id
      and list_entry.list_id = p_list_id
      and list_entry.entry_type = 'book'
      and reading_order.book_id = list_entry.book_id;
end;
$$;

create or replace function public.revert_list_entries_v2(
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

    perform 1
    from reading_list
    where list_id = p_list_id
    for update;
    if not found then
        raise exception 'list % not found', p_list_id;
    end if;

    if p_snapshot ? 'list_name' then
        update reading_list
        set list_name = p_snapshot->>'list_name'
        where list_id = p_list_id;
    end if;

    -- New mixed snapshots include dividers and restore exact membership.
    -- Legacy book-only snapshots retain add-only semantics and never remove
    -- canonical dividers or concurrently-added books.
    if p_snapshot ? 'dividers' then
        delete from list_entry
        where list_id = p_list_id
          and entry_type = 'book'
          and book_id not in (
              select (item->>'book_id')::integer
              from jsonb_array_elements(coalesce(p_snapshot->'books', '[]'::jsonb)) as item
          );

        delete from list_entry
        where list_id = p_list_id
          and entry_type = 'divider'
          and entry_id not in (
              select (item->>'entry_id')::integer
              from jsonb_array_elements(p_snapshot->'dividers') as item
          );
    end if;

    for v_item in
        select *
        from jsonb_array_elements(coalesce(p_snapshot->'books', '[]'::jsonb))
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

        update list_entry
        set read_order = (v_item->>'read_order')::integer
        where list_id = p_list_id
          and entry_type = 'book'
          and book_id = (v_item->>'book_id')::integer;

        if not found then
            if v_item ? 'entry_id' then
                if exists (
                    select 1
                    from list_entry
                    where entry_id = (v_item->>'entry_id')::integer
                ) then
                    raise exception 'entry ID % is already in use', v_item->>'entry_id';
                end if;

                insert into list_entry (
                    entry_id,
                    list_id,
                    entry_type,
                    book_id,
                    divider_name,
                    read_order
                )
                values (
                    (v_item->>'entry_id')::integer,
                    p_list_id,
                    'book',
                    (v_item->>'book_id')::integer,
                    null,
                    (v_item->>'read_order')::integer
                );
            else
                insert into list_entry (
                    list_id,
                    entry_type,
                    book_id,
                    divider_name,
                    read_order
                )
                values (
                    p_list_id,
                    'book',
                    (v_item->>'book_id')::integer,
                    null,
                    (v_item->>'read_order')::integer
                );
            end if;
        end if;
    end loop;

    for v_item in
        select *
        from jsonb_array_elements(coalesce(p_snapshot->'dividers', '[]'::jsonb))
    loop
        if exists (
            select 1
            from list_entry
            where entry_id = (v_item->>'entry_id')::integer
              and list_id <> p_list_id
        ) then
            raise exception 'divider entry % belongs to another list', v_item->>'entry_id';
        end if;

        insert into list_entry (
            entry_id,
            list_id,
            entry_type,
            book_id,
            divider_name,
            read_order
        )
        values (
            (v_item->>'entry_id')::integer,
            p_list_id,
            'divider',
            null,
            btrim(v_item->>'divider_name'),
            (v_item->>'read_order')::integer
        )
        on conflict (entry_id)
        do update set
            divider_name = excluded.divider_name,
            read_order = excluded.read_order;
    end loop;

    delete from reading_order where list_id = p_list_id;
    insert into reading_order (list_id, book_id, read_order)
    select list_id, book_id, read_order
    from list_entry
    where list_id = p_list_id
      and entry_type = 'book';
end;
$$;

-- Legacy divider RPC names used by the previous deployed UI.
create or replace function public.create_section_divider(
    p_secret text,
    p_list_id integer,
    p_divider_name text,
    p_before_entry_id integer default null
)
returns integer
language sql
security definer
set search_path = public
as $$
    select create_section_divider_v2(
        p_secret,
        p_list_id,
        p_divider_name,
        p_before_entry_id
    );
$$;

create or replace function public.update_section_divider(
    p_secret text,
    p_divider_id integer,
    p_divider_name text
)
returns void
language sql
security definer
set search_path = public
as $$
    select update_section_divider_v2(p_secret, p_divider_id, p_divider_name);
$$;

create or replace function public.delete_section_divider(
    p_secret text,
    p_divider_id integer
)
returns void
language sql
security definer
set search_path = public
as $$
    select delete_list_entry_v2(
        p_secret,
        (select list_id from list_entry where entry_id = p_divider_id),
        p_divider_id
    );
$$;

create or replace function public.reorder_list_entries(
    p_secret text,
    p_list_id integer,
    p_entry_ids integer[]
)
returns void
language sql
security definer
set search_path = public
as $$
    select reorder_list_entries_v2(p_secret, p_list_id, p_entry_ids);
$$;

create or replace function public.revert_list(
    p_secret text,
    p_list_id integer,
    p_snapshot jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
    select revert_list_entries_v2(p_secret, p_list_id, p_snapshot);
$$;

-- Book-only compatibility RPCs used by the current frontend during rollout.
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
    perform 1
    from reading_list
    where list_id = p_list_id
    for update;
    if not found then
        raise exception 'list % not found', p_list_id;
    end if;

    delete from list_entry
    where list_id = p_list_id
      and entry_type = 'book'
      and book_id = p_book_id;
    delete from reading_order
    where list_id = p_list_id
      and book_id = p_book_id;
end;
$$;

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
    v_book_slots integer[];
    v_book_count integer;
    v_index integer;
begin
    perform _check_secret(p_secret);
    perform 1
    from reading_list
    where list_id = p_list_id
    for update;
    if not found then
        raise exception 'list % not found', p_list_id;
    end if;

    select
        array_agg(read_order order by read_order, entry_id),
        count(*)
    into v_book_slots, v_book_count
    from list_entry
    where list_id = p_list_id
      and entry_type = 'book';

    if coalesce(cardinality(p_book_ids), 0) <> v_book_count
       or (
           select count(distinct book_id)
           from unnest(coalesce(p_book_ids, array[]::integer[])) as book_id
       ) <> v_book_count
       or exists (
           select 1
           from unnest(coalesce(p_book_ids, array[]::integer[])) as requested(book_id)
           where not exists (
               select 1
               from list_entry
               where list_entry.list_id = p_list_id
                 and list_entry.entry_type = 'book'
                 and list_entry.book_id = requested.book_id
           )
       ) then
        raise exception 'book order must contain every list book exactly once';
    end if;

    for v_index in 1..v_book_count
    loop
        v_book_id := p_book_ids[v_index];
        update list_entry
        set read_order = v_book_slots[v_index]
        where list_id = p_list_id
          and entry_type = 'book'
          and book_id = v_book_id;
        update reading_order
        set read_order = v_book_slots[v_index]
        where list_id = p_list_id
          and book_id = v_book_id;
    end loop;
end;
$$;

revoke all on function
    public.create_section_divider_v2(text, integer, text, integer),
    public.update_section_divider_v2(text, integer, text),
    public.delete_list_entry_v2(text, integer, integer),
    public.reorder_list_entries_v2(text, integer, integer[]),
    public.revert_list_entries_v2(text, integer, jsonb),
    public.create_section_divider(text, integer, text, integer),
    public.update_section_divider(text, integer, text),
    public.delete_section_divider(text, integer),
    public.reorder_list_entries(text, integer, integer[])
from public;

grant execute on function
    public.create_section_divider_v2(text, integer, text, integer),
    public.update_section_divider_v2(text, integer, text),
    public.delete_list_entry_v2(text, integer, integer),
    public.reorder_list_entries_v2(text, integer, integer[]),
    public.revert_list_entries_v2(text, integer, jsonb),
    public.create_section_divider(text, integer, text, integer),
    public.update_section_divider(text, integer, text),
    public.delete_section_divider(text, integer),
    public.reorder_list_entries(text, integer, integer[])
to anon, authenticated;

grant execute on function
    public.add_book_to_list(text, integer, text, text, text, text, text, date, text),
    public.remove_book_from_list(text, integer, integer),
    public.reorder_list(text, integer, integer[]),
    public.revert_list(text, integer, jsonb)
to anon, authenticated;

notify pgrst, 'reload schema';

commit;
