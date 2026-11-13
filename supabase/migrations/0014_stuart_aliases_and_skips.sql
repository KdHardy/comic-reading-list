-- Stuart: series aliases and skipped comics.
--
-- * stuart_series_alias maps a series name used in the reading lists to the
--   title (and optionally start year / publisher) to look it up by, e.g. the
--   wiki's "Buffy Classic" is ComicVine's "Buffy the Vampire Slayer" (1998).
-- * Backup stories and extras ("… short", "… extra") aren't issues of a
--   series; Stuart marks them scan_state = 'skipped' instead of failing them.

begin;

create table if not exists public.stuart_series_alias (
    alias       text primary key check (btrim(alias) <> ''),
    title       text not null check (btrim(title) <> ''),
    start_year  integer,
    publisher   text,
    note        text,
    created_at  timestamptz not null default now()
);

alter table public.stuart_series_alias enable row level security;
revoke insert, update, delete, truncate, references, trigger on table public.stuart_series_alias from anon, authenticated;
grant select on table public.stuart_series_alias to anon, authenticated;
grant all on table public.stuart_series_alias to service_role;
drop policy if exists "public read access" on public.stuart_series_alias;
create policy "public read access" on public.stuart_series_alias for select to anon, authenticated using (true);

insert into public.stuart_series_alias (alias, title, start_year, publisher, note) values
    ('Buffy Classic', 'Buffy the Vampire Slayer', 1998, 'Dark Horse Comics',
     'The Buffy wiki calls the 1998–2003 Dark Horse run "Buffy Classic"; ComicVine''s "Buffy the Vampire Slayer Classic" (2011) is a reprint line.')
on conflict (alias) do nothing;

alter table public.book drop constraint if exists book_scan_state_check;
alter table public.book
    add constraint book_scan_state_check check (scan_state in ('pending', 'matched', 'failed', 'skipped'));

create or replace function public.stuart_skip_book(p_book_id integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update stuart_scan_error set cleared_at = now()
    where book_id = p_book_id and cleared_at is null;

    perform set_config('stuart.applying', 'on', true);
    update book
    set scan_state = 'skipped',
        last_scanned_at = now(),
        next_scan_after = null
    where book_id = p_book_id;
    perform set_config('stuart.applying', 'off', true);
end;
$$;

revoke all on function public.stuart_skip_book(integer, text) from public, anon, authenticated;
grant execute on function public.stuart_skip_book(integer, text) to service_role;

notify pgrst, 'reload schema';

commit;
