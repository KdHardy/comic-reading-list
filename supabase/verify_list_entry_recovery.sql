-- Read-only verification for 0010_restore_list_entry_canonical.sql.
-- Run after applying the migration; any mismatch raises an exception.

do $$
declare
    v_signature text;
begin
    if to_regclass('public.list_entry') is null then
        raise exception 'public.list_entry is missing';
    end if;

    if to_regclass('public.idx_list_entry_order') is null
       or to_regclass('public.idx_list_entry_unique_book') is null then
        raise exception 'list_entry indexes are missing';
    end if;

    if not (
        select relrowsecurity
        from pg_class
        where oid = 'public.list_entry'::regclass
    ) then
        raise exception 'RLS is not enabled on list_entry';
    end if;

    if not has_table_privilege('anon', 'public.list_entry', 'SELECT')
       or not has_table_privilege('authenticated', 'public.list_entry', 'SELECT')
       or has_table_privilege('anon', 'public.list_entry', 'INSERT, UPDATE, DELETE')
       or has_table_privilege('authenticated', 'public.list_entry', 'INSERT, UPDATE, DELETE')
       or not has_table_privilege(
           'service_role',
           'public.list_entry',
           'SELECT, INSERT, UPDATE, DELETE'
       ) then
        raise exception 'list_entry grants are incorrect';
    end if;

    if exists (
        select 1
        from list_entry
        where (
            entry_type = 'book'
            and (book_id is null or divider_name is not null)
        )
        or (
            entry_type = 'divider'
            and (book_id is not null or btrim(coalesce(divider_name, '')) = '')
        )
        or entry_type not in ('book', 'divider')
    ) then
        raise exception 'list_entry contains invalid mixed-entry rows';
    end if;

    if exists (
        select 1
        from list_entry
        where entry_type = 'book'
        group by list_id, book_id
        having count(*) > 1
    ) then
        raise exception 'list_entry contains duplicate book memberships';
    end if;

    if exists (
        select 1
        from reading_order
        where not exists (
            select 1
            from list_entry
            where list_entry.list_id = reading_order.list_id
              and list_entry.entry_type = 'book'
              and list_entry.book_id = reading_order.book_id
              and list_entry.read_order = reading_order.read_order
        )
    ) then
        raise exception 'reading_order contains a book missing from canonical list_entry';
    end if;

    if exists (
        select 1
        from list_entry
        where entry_type = 'book'
          and not exists (
              select 1
              from reading_order
              where reading_order.list_id = list_entry.list_id
                and reading_order.book_id = list_entry.book_id
                and reading_order.read_order = list_entry.read_order
          )
    ) then
        raise exception 'reading_order compatibility mirror is incomplete';
    end if;

    foreach v_signature in array array[
        'public.create_section_divider_v2(text,integer,text,integer)',
        'public.update_section_divider_v2(text,integer,text)',
        'public.delete_list_entry_v2(text,integer,integer)',
        'public.reorder_list_entries_v2(text,integer,integer[])',
        'public.revert_list_entries_v2(text,integer,jsonb)',
        'public.create_section_divider(text,integer,text,integer)',
        'public.update_section_divider(text,integer,text)',
        'public.delete_section_divider(text,integer)',
        'public.reorder_list_entries(text,integer,integer[])'
    ]
    loop
        if to_regprocedure(v_signature) is null then
            raise exception 'required mixed-entry RPC % is missing', v_signature;
        end if;
    end loop;

    raise notice 'list_entry recovery verification passed';
end;
$$;

select
    list_id,
    count(*) filter (where entry_type = 'book') as book_entries,
    count(*) filter (where entry_type = 'divider') as divider_entries
from public.list_entry
group by list_id
order by list_id;
