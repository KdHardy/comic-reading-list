-- Update book thumbnail when re-adding an existing title from the extension.
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
