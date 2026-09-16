-- Read-only verification for 0009_repair_reading_order.sql.
-- Run this in the Supabase SQL Editor after applying the migration.
-- Success produces one NOTICE and one row-count result; any mismatch raises.

do $$
declare
    v_function regprocedure;
begin
    if to_regclass('public.reading_order') is null then
        raise exception 'public.reading_order is missing';
    end if;

    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reading_order'
          and column_name = 'list_id'
          and data_type = 'integer'
          and is_nullable = 'NO'
    ) or not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reading_order'
          and column_name = 'book_id'
          and data_type = 'integer'
          and is_nullable = 'NO'
    ) or not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reading_order'
          and column_name = 'read_order'
          and data_type = 'integer'
          and is_nullable = 'NO'
    ) then
        raise exception 'reading_order columns do not match the expected schema';
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reading_order'::regclass
          and contype = 'p'
          and conkey = array[
              (
                  select attnum
                  from pg_attribute
                  where attrelid = 'public.reading_order'::regclass
                    and attname = 'list_id'
              ),
              (
                  select attnum
                  from pg_attribute
                  where attrelid = 'public.reading_order'::regclass
                    and attname = 'book_id'
              )
          ]::smallint[]
    ) then
        raise exception 'reading_order primary key is missing or incorrect';
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reading_order'::regclass
          and confrelid = 'public.reading_list'::regclass
          and contype = 'f'
          and confdeltype = 'c'
    ) or not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reading_order'::regclass
          and confrelid = 'public.book'::regclass
          and contype = 'f'
          and confdeltype = 'c'
    ) then
        raise exception 'reading_order cascade foreign keys are missing';
    end if;

    if to_regclass('public.idx_reading_order_list') is null
       or pg_get_indexdef(to_regclass('public.idx_reading_order_list'))
          not like '%(list_id, read_order)%' then
        raise exception 'idx_reading_order_list is missing';
    end if;

    if not (
        select relrowsecurity
        from pg_class
        where oid = 'public.reading_order'::regclass
    ) then
        raise exception 'RLS is not enabled on reading_order';
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'reading_order'
          and policyname = 'public read access'
          and cmd = 'SELECT'
          and roles @> array['anon', 'authenticated']::name[]
    ) then
        raise exception 'reading_order public read policy is missing';
    end if;

    if not has_table_privilege('anon', 'public.reading_order', 'SELECT')
       or not has_table_privilege('authenticated', 'public.reading_order', 'SELECT')
       or has_table_privilege('anon', 'public.reading_order', 'INSERT, UPDATE, DELETE')
       or has_table_privilege('authenticated', 'public.reading_order', 'INSERT, UPDATE, DELETE') then
        raise exception 'reading_order table privileges are incorrect';
    end if;

    if not exists (
        select 1
        from pg_proc
        where oid = to_regprocedure('public._check_secret(text)')
          and prosecdef
          and proconfig @> array['search_path=public']
    ) then
        raise exception '_check_secret(text) has unexpected SECURITY DEFINER configuration';
    end if;

    foreach v_function in array array[
        to_regprocedure(
            'public.add_book_to_list(text,integer,text,text,text,text,text,date,text)'
        ),
        to_regprocedure('public.reorder_list(text,integer,integer[])'),
        to_regprocedure('public.remove_book_from_list(text,integer,integer)'),
        to_regprocedure('public.revert_list(text,integer,jsonb)')
    ]
    loop
        if v_function is null then
            raise exception 'a required reading_order RPC is missing';
        end if;

        if not has_function_privilege('anon', v_function, 'EXECUTE')
           or not has_function_privilege('authenticated', v_function, 'EXECUTE') then
            raise exception 'required RPC % lacks execute grants', v_function;
        end if;

        if not exists (
            select 1
            from pg_proc
            where oid = v_function
              and prosecdef
              and proconfig @> array['search_path=public']
        ) then
            raise exception 'required RPC % has unexpected SECURITY DEFINER configuration', v_function;
        end if;
    end loop;

    raise notice 'reading_order repair verification passed';
end;
$$;

select count(*) as reading_order_row_count
from public.reading_order;
