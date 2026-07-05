-- Comic Reading List — write RPC functions
--
-- All mutating operations go through these SECURITY DEFINER functions instead
-- of direct table writes. Each one validates a shared secret (see
-- 0003_security.sql for why direct table writes are blocked) before doing
-- anything. The browser extension and the web app both call these via
-- Supabase's auto-generated RPC endpoint (`/rest/v1/rpc/<function_name>`),
-- sending the secret as a normal parameter.

create or replace function _check_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_secret is null or not exists (select 1 from app_secret where secret = p_secret) then
        raise exception 'unauthorized' using errcode = '28000';
    end if;
end;
$$;

-- Create a new reading list, returns the new list_id.
create or replace function create_reading_list(p_secret text, p_list_name text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_list_id integer;
begin
    perform _check_secret(p_secret);

    if btrim(coalesce(p_list_name, '')) = '' then
        raise exception 'list name cannot be blank';
    end if;

    insert into reading_list (list_name) values (btrim(p_list_name))
    returning list_id into v_list_id;

    return v_list_id;
end;
$$;

-- Find-or-create a Book (by series+volume+number+publisher) and append it to
-- a list's reading order. Mirrors the extension's submit logic exactly.
create or replace function add_book_to_list(
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

-- Rename a list. Enforces the "title cannot be blank" rule server-side too.
create or replace function update_list_title(p_secret text, p_list_id integer, p_new_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform _check_secret(p_secret);

    if btrim(coalesce(p_new_title, '')) = '' then
        raise exception 'title cannot be blank';
    end if;

    update reading_list set list_name = btrim(p_new_title) where list_id = p_list_id;
end;
$$;

-- Toggle a book's completed flag; stamps/clears completed_date to match.
create or replace function set_book_completed(p_secret text, p_book_id integer, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform _check_secret(p_secret);

    update book
    set completed = p_completed,
        completed_date = case when p_completed then now() else null end
    where book_id = p_book_id;
end;
$$;

-- Set one of a book's three location slots (p_slot = 1, 2, or 3).
create or replace function set_book_location(p_secret text, p_book_id integer, p_slot integer, p_location_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform _check_secret(p_secret);

    if p_slot not in (1, 2, 3) then
        raise exception 'slot must be 1, 2, or 3';
    end if;

    update book
    set location1_id = case when p_slot = 1 then p_location_id else location1_id end,
        location2_id = case when p_slot = 2 then p_location_id else location2_id end,
        location3_id = case when p_slot = 3 then p_location_id else location3_id end
    where book_id = p_book_id;
end;
$$;

-- Reorder a list. The client (up/down buttons or drag handle) computes the
-- full new book_id order and sends it here; read_order is reassigned with
-- gaps of 10 so future single-item inserts/moves are cheap.
create or replace function reorder_list(p_secret text, p_list_id integer, p_book_ids integer[])
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

-- Restore a list (title + every book's completed/location/order) to a
-- snapshot captured client-side when the page loaded. Backs the Revert button.
create or replace function revert_list(p_secret text, p_list_id integer, p_snapshot jsonb)
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
        update reading_list set list_name = p_snapshot->>'list_name' where list_id = p_list_id;
    end if;

    for v_item in select jsonb_array_elements(p_snapshot->'books')
    loop
        update book
        set completed     = (v_item->>'completed')::boolean,
            completed_date = case when (v_item->>'completed')::boolean
                                   then (v_item->>'completed_date')::timestamptz
                                   else null end,
            location1_id  = (v_item->>'location1_id')::integer,
            location2_id  = (v_item->>'location2_id')::integer,
            location3_id  = (v_item->>'location3_id')::integer
        where book_id = (v_item->>'book_id')::integer;

        update reading_order
        set read_order = (v_item->>'read_order')::integer
        where list_id = p_list_id and book_id = (v_item->>'book_id')::integer;
    end loop;
end;
$$;

grant execute on function
    create_reading_list(text, text),
    add_book_to_list(text, integer, text, text, text, text, text, date, text),
    update_list_title(text, integer, text),
    set_book_completed(text, integer, boolean),
    set_book_location(text, integer, integer, integer),
    reorder_list(text, integer, integer[]),
    revert_list(text, integer, jsonb)
to anon, authenticated;
