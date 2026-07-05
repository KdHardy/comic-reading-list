-- Comic Reading List — support removing a single book from a list (the
-- delete button on each row), and make the Revert button able to restore a
-- book that was removed since the page loaded.

-- Delete-from-list RPC backing the row delete button. Only removes the
-- reading_order join row — the book row itself is left in place, so
-- re-adding it later via add_book_to_list finds it again instead of
-- creating a duplicate, and any other list it's on is unaffected.
create or replace function remove_book_from_list(p_secret text, p_list_id integer, p_book_id integer)
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

grant execute on function remove_book_from_list(text, integer, integer) to anon, authenticated;

-- Fix: revert_list previously only UPDATEd existing reading_order rows, so
-- reverting after a delete wouldn't bring the row back (there was nothing
-- to update). Upsert instead so a removed book is re-inserted on revert.
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

        insert into reading_order (list_id, book_id, read_order)
        values (p_list_id, (v_item->>'book_id')::integer, (v_item->>'read_order')::integer)
        on conflict (list_id, book_id) do update set read_order = excluded.read_order;
    end loop;
end;
$$;
