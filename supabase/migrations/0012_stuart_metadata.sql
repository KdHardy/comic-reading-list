-- Stuart: the comic metadata agent (schema).
--
-- Stuart is a Supabase Edge Function (supabase/functions/stuart) that looks up
-- each book on an online comic database (ComicVine first) and records:
--   * the canonical series/volume the issue belongs to (series_volume),
--   * the story arcs it is part of (storyline + book_storyline),
--   * blank publisher / publish date on the book, when they can be filled safely.
--
-- The user's own series/volume/publisher text on `book` is never overwritten:
-- the match is stored alongside it, so it can be reviewed or undone.
--
-- Scheduling (pg_cron + pg_net) lives in 0013_stuart_schedule.sql so this file
-- stays testable without those extensions.

begin;

-- ---------------------------------------------------------------------------
-- Canonical series/volumes and storylines
-- ---------------------------------------------------------------------------

create table if not exists public.series_volume (
    series_volume_id  bigserial primary key,
    source            text not null default 'comicvine',
    source_id         text not null,
    name              text not null,
    start_year        integer,
    publisher         text,
    count_of_issues   integer,
    last_issue_number text,
    last_issue_date   date,
    is_ongoing        boolean,
    site_url          text,
    updated_at        timestamptz not null default now(),
    unique (source, source_id)
);

create table if not exists public.storyline (
    storyline_id  bigserial primary key,
    source        text not null default 'comicvine',
    source_id     text not null,
    name          text not null,
    publisher     text,
    issue_count   integer,
    site_url      text,
    updated_at    timestamptz not null default now(),
    unique (source, source_id)
);

-- reading_order_position is optional: comic databases rarely provide it.
create table if not exists public.book_storyline (
    book_id                 integer not null references public.book (book_id) on delete cascade,
    storyline_id            bigint not null references public.storyline (storyline_id) on delete cascade,
    reading_order_position  integer,
    source                  text not null default 'comicvine',
    primary key (book_id, storyline_id)
);

create index if not exists idx_book_storyline_storyline on public.book_storyline (storyline_id);

-- ---------------------------------------------------------------------------
-- Per-book scan state
-- ---------------------------------------------------------------------------

alter table public.book
    add column if not exists series_volume_id  bigint references public.series_volume (series_volume_id) on delete set null,
    add column if not exists source_issue_id   text,
    -- pending: needs a scan (once next_scan_after has passed, if set);
    -- matched: done; failed: every adapter failed (retried after
    -- next_scan_after, up to 3 attempts).
    add column if not exists scan_state        text not null default 'pending',
    add column if not exists scan_attempts     integer not null default 0,
    add column if not exists last_scanned_at   timestamptz,
    add column if not exists next_scan_after   timestamptz;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'book_scan_state_check') then
        alter table public.book
            add constraint book_scan_state_check check (scan_state in ('pending', 'matched', 'failed'));
    end if;
end $$;

create index if not exists idx_book_scan_state on public.book (scan_state, next_scan_after);
create index if not exists idx_book_series_volume on public.book (series_volume_id);

-- A book needs a fresh scan whenever its identifying fields change, unless the
-- change is Stuart's own (stuart_apply_book_match sets stuart.applying).
create or replace function public._book_mark_for_scan()
returns trigger
language plpgsql
as $$
begin
    if coalesce(current_setting('stuart.applying', true), '') = 'on' then
        return new;
    end if;

    if tg_op = 'INSERT'
       or new.series is distinct from old.series
       or new.volume is distinct from old.volume
       or new.number is distinct from old.number
       or new.publisher is distinct from old.publisher
       or new.publish_date is distinct from old.publish_date then
        new.scan_state := 'pending';
        new.scan_attempts := 0;
        new.next_scan_after := null;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_book_mark_for_scan on public.book;
create trigger trg_book_mark_for_scan
    before insert or update on public.book
    for each row execute function public._book_mark_for_scan();

-- ---------------------------------------------------------------------------
-- Runs, errors and settings
-- ---------------------------------------------------------------------------

create table if not exists public.stuart_run (
    run_id         bigserial primary key,
    trigger        text not null default 'nightly',
    status         text not null default 'running'
                   check (status in ('running', 'completed', 'partial', 'failed')),
    started_at     timestamptz not null default now(),
    finished_at    timestamptz,
    books_matched  integer not null default 0,
    books_failed   integer not null default 0,
    requests       jsonb not null default '{}'::jsonb,
    note           text
);

create index if not exists idx_stuart_run_started on public.stuart_run (started_at desc);

create table if not exists public.stuart_scan_error (
    error_id    bigserial primary key,
    run_id      bigint references public.stuart_run (run_id) on delete set null,
    book_id     integer references public.book (book_id) on delete cascade,
    series      text,
    volume      text,
    publisher   text,
    number      text,
    adapter     text not null,
    code        text not null,
    message     text not null,
    details     jsonb,
    created_at  timestamptz not null default now(),
    cleared_at  timestamptz
);

create index if not exists idx_stuart_scan_error_open
    on public.stuart_scan_error (created_at desc) where cleared_at is null;
create index if not exists idx_stuart_scan_error_book on public.stuart_scan_error (book_id);

create table if not exists public.stuart_config (
    singleton          boolean primary key default true check (singleton),
    enabled            boolean not null default true,
    -- e.g. https://<project-ref>.supabase.co/functions/v1/stuart
    function_url       text,
    timezone           text not null default 'America/Los_Angeles',
    -- Local-time window (hours, [start, end)) in which nightly batches may run.
    window_start_hour  integer not null default 0 check (window_start_hour between 0 and 23),
    window_end_hour    integer not null default 6 check (window_end_hour between 1 and 24)
);

insert into public.stuart_config (singleton) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Access: public read for what the web app shows; no direct writes.
-- ---------------------------------------------------------------------------

alter table public.series_volume     enable row level security;
alter table public.storyline         enable row level security;
alter table public.book_storyline    enable row level security;
alter table public.stuart_run        enable row level security;
alter table public.stuart_scan_error enable row level security;
alter table public.stuart_config     enable row level security;

revoke insert, update, delete, truncate, references, trigger on table
    public.series_volume, public.storyline, public.book_storyline,
    public.stuart_run, public.stuart_scan_error
from anon, authenticated;
revoke all on table public.stuart_config from anon, authenticated;

grant select on table
    public.series_volume, public.storyline, public.book_storyline,
    public.stuart_run, public.stuart_scan_error
to anon, authenticated;

grant all on table
    public.series_volume, public.storyline, public.book_storyline,
    public.stuart_run, public.stuart_scan_error, public.stuart_config
to service_role;
grant usage, select on all sequences in schema public to service_role;

drop policy if exists "public read access" on public.series_volume;
create policy "public read access" on public.series_volume for select to anon, authenticated using (true);
drop policy if exists "public read access" on public.storyline;
create policy "public read access" on public.storyline for select to anon, authenticated using (true);
drop policy if exists "public read access" on public.book_storyline;
create policy "public read access" on public.book_storyline for select to anon, authenticated using (true);
drop policy if exists "public read access" on public.stuart_run;
create policy "public read access" on public.stuart_run for select to anon, authenticated using (true);
drop policy if exists "public read access" on public.stuart_scan_error;
create policy "public read access" on public.stuart_scan_error for select to anon, authenticated using (true);
-- stuart_config: no policy, so it is unreachable through the REST API.

-- ---------------------------------------------------------------------------
-- Pull List key: matched books group under their canonical series/volume.
-- ---------------------------------------------------------------------------

-- The (series, volume, publisher) key a book appears under on the Pull List.
-- Must stay in step with seriesKeyOf() in web/src/lib/pullList.ts.
create or replace function public.book_pull_list_key(p_book_id integer)
returns table (series text, volume text, publisher text)
language sql
stable
security definer
set search_path = public
as $$
    select
        coalesce(sv.name, b.series),
        case when sv.series_volume_id is not null
             then coalesce(sv.start_year::text, '')
             else coalesce(b.volume, '') end,
        case when sv.series_volume_id is not null
             then coalesce(sv.publisher, '')
             else coalesce(b.publisher, '') end
    from book b
    left join series_volume sv on sv.series_volume_id = b.series_volume_id
    where b.book_id = p_book_id;
$$;

grant execute on function public.book_pull_list_key(integer) to anon, authenticated, service_role;

-- Title art may come from any cover that appears under the series' Pull List key.
create or replace function public.set_pull_list_series_title_art(
    p_secret text,
    p_series text,
    p_volume text,
    p_publisher text,
    p_book_id integer,
    p_x real,
    p_y real,
    p_w real,
    p_h real
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
begin
    perform _check_secret(p_secret);

    if p_book_id is not null and not exists (
        select 1
        from book_pull_list_key(p_book_id) k
        where k.series = p_series
          and k.volume = coalesce(p_volume, '')
          and k.publisher = coalesce(p_publisher, '')
    ) then
        raise exception 'book % is not part of this series', p_book_id;
    end if;

    v_id := _ensure_pull_list_series(p_series, p_volume, p_publisher);
    update pull_list_series
    set title_art_book_id = p_book_id,
        title_art_x = case when p_book_id is null then null else p_x end,
        title_art_y = case when p_book_id is null then null else p_y end,
        title_art_w = case when p_book_id is null then null else p_w end,
        title_art_h = case when p_book_id is null then null else p_h end,
        updated_at = now()
    where pull_list_series_id = v_id;
end;
$$;

-- When books move to a canonical key, carry over the user's Pull List choices
-- (family, status, order, title art) without overwriting ones already set there.
create or replace function public._carry_pull_list_meta(
    p_from_series text, p_from_volume text, p_from_publisher text,
    p_to_series text, p_to_volume text, p_to_publisher text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_from pull_list_series%rowtype;
    v_to_id bigint;
begin
    if p_from_series = p_to_series
       and coalesce(p_from_volume, '') = coalesce(p_to_volume, '')
       and coalesce(p_from_publisher, '') = coalesce(p_to_publisher, '') then
        return;
    end if;

    select * into v_from
    from pull_list_series
    where series = p_from_series
      and volume = coalesce(p_from_volume, '')
      and publisher = coalesce(p_from_publisher, '');
    if not found then
        return;
    end if;

    v_to_id := _ensure_pull_list_series(p_to_series, p_to_volume, p_to_publisher);
    update pull_list_series t
    set family = coalesce(t.family, v_from.family),
        status = coalesce(t.status, v_from.status),
        sort_order = coalesce(t.sort_order, v_from.sort_order),
        title_art_book_id = case when t.title_art_book_id is null then v_from.title_art_book_id else t.title_art_book_id end,
        title_art_x = case when t.title_art_book_id is null then v_from.title_art_x else t.title_art_x end,
        title_art_y = case when t.title_art_book_id is null then v_from.title_art_y else t.title_art_y end,
        title_art_w = case when t.title_art_book_id is null then v_from.title_art_w else t.title_art_w end,
        title_art_h = case when t.title_art_book_id is null then v_from.title_art_h else t.title_art_h end,
        updated_at = now()
    where t.pull_list_series_id = v_to_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes used by the Stuart Edge Function (service role only).
-- ---------------------------------------------------------------------------

-- Books Stuart should look at now, grouped by the user's own series key.
create or replace function public.stuart_pending_books(p_limit integer default 500)
returns table (
    book_id integer,
    series text,
    volume text,
    publisher text,
    number text,
    publish_date date,
    scan_attempts integer
)
language sql
stable
security definer
set search_path = public
as $$
    select b.book_id, b.series, b.volume, b.publisher, b.number, b.publish_date, b.scan_attempts
    from book b
    where (b.scan_state = 'pending' and (b.next_scan_after is null or b.next_scan_after <= now()))
       or (b.scan_state = 'failed' and b.scan_attempts < 3
           and b.next_scan_after is not null and b.next_scan_after <= now())
    order by b.series, coalesce(b.volume, ''), coalesce(b.publisher, ''), b.book_id
    limit greatest(p_limit, 0);
$$;

create or replace function public.stuart_pending_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
    from book b
    where (b.scan_state = 'pending' and (b.next_scan_after is null or b.next_scan_after <= now()))
       or (b.scan_state = 'failed' and b.scan_attempts < 3
           and b.next_scan_after is not null and b.next_scan_after <= now());
$$;

-- A series/volume this group of books was already matched to (saves lookups).
create or replace function public.stuart_known_volume(p_series text, p_volume text, p_publisher text)
returns table (series_volume_id bigint, source text, source_id text)
language sql
stable
security definer
set search_path = public
as $$
    select sv.series_volume_id, sv.source, sv.source_id
    from book b
    join series_volume sv on sv.series_volume_id = b.series_volume_id
    where b.series = p_series
      and coalesce(b.volume, '') = coalesce(p_volume, '')
      and coalesce(b.publisher, '') = coalesce(p_publisher, '')
    order by b.last_scanned_at desc nulls last
    limit 1;
$$;

create or replace function public.stuart_upsert_series_volume(p_volume jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
begin
    insert into series_volume (
        source, source_id, name, start_year, publisher, count_of_issues,
        last_issue_number, last_issue_date, is_ongoing, site_url, updated_at
    ) values (
        coalesce(p_volume->>'source', 'comicvine'),
        p_volume->>'source_id',
        p_volume->>'name',
        (p_volume->>'start_year')::integer,
        p_volume->>'publisher',
        (p_volume->>'count_of_issues')::integer,
        p_volume->>'last_issue_number',
        (p_volume->>'last_issue_date')::date,
        (p_volume->>'is_ongoing')::boolean,
        p_volume->>'site_url',
        now()
    )
    on conflict (source, source_id) do update
    set name = excluded.name,
        start_year = excluded.start_year,
        publisher = excluded.publisher,
        count_of_issues = excluded.count_of_issues,
        last_issue_number = excluded.last_issue_number,
        last_issue_date = excluded.last_issue_date,
        is_ongoing = excluded.is_ongoing,
        site_url = excluded.site_url,
        updated_at = now()
    returning series_volume_id into v_id;

    return v_id;
end;
$$;

-- Record a successful match for one book: link the series/volume and story
-- arcs, fill blank publisher/date when that cannot collide with another book,
-- clear its open errors, and carry its Pull List choices to the new key.
-- With no p_source_issue_id (the volume matched but the issue isn't in the
-- database yet) the book is looked at again in 30 days.
-- p_storylines: [{source_id, name, publisher?, issue_count?, site_url?}]
create or replace function public.stuart_apply_book_match(
    p_book_id integer,
    p_series_volume_id bigint,
    p_source_issue_id text,
    p_publish_date date,
    p_storylines jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_book book%rowtype;
    v_sv series_volume%rowtype;
    v_arc jsonb;
    v_storyline_id bigint;
    v_fill_publisher text;
begin
    select * into v_book from book where book_id = p_book_id for update;
    if not found then
        return;
    end if;
    select * into v_sv from series_volume where series_volume_id = p_series_volume_id;
    if not found then
        raise exception 'series_volume % not found', p_series_volume_id;
    end if;

    -- Filling the publisher changes the book's dedupe key; skip it if another
    -- book already holds that key.
    if v_book.publisher is null and v_sv.publisher is not null and not exists (
        select 1 from book o
        where o.book_id <> v_book.book_id
          and o.series = v_book.series
          and coalesce(o.volume, '') = coalesce(v_book.volume, '')
          and coalesce(o.number, '') = coalesce(v_book.number, '')
          and o.publisher = v_sv.publisher
    ) then
        v_fill_publisher := v_sv.publisher;
    end if;

    perform set_config('stuart.applying', 'on', true);

    update book
    set series_volume_id = p_series_volume_id,
        source_issue_id = p_source_issue_id,
        publisher = coalesce(publisher, v_fill_publisher),
        publish_date = coalesce(publish_date, p_publish_date),
        scan_state = case when p_source_issue_id is null then 'pending' else 'matched' end,
        last_scanned_at = now(),
        next_scan_after = case when p_source_issue_id is null then now() + interval '30 days' end
    where book_id = p_book_id;

    perform set_config('stuart.applying', 'off', true);

    delete from book_storyline where book_id = p_book_id and source = v_sv.source;
    for v_arc in select jsonb_array_elements(coalesce(p_storylines, '[]'::jsonb))
    loop
        insert into storyline (source, source_id, name, publisher, issue_count, site_url, updated_at)
        values (
            v_sv.source,
            v_arc->>'source_id',
            v_arc->>'name',
            v_arc->>'publisher',
            (v_arc->>'issue_count')::integer,
            v_arc->>'site_url',
            now()
        )
        on conflict (source, source_id) do update
        set name = excluded.name,
            publisher = coalesce(excluded.publisher, storyline.publisher),
            issue_count = coalesce(excluded.issue_count, storyline.issue_count),
            site_url = coalesce(excluded.site_url, storyline.site_url),
            updated_at = now()
        returning storyline_id into v_storyline_id;

        insert into book_storyline (book_id, storyline_id, source)
        values (p_book_id, v_storyline_id, v_sv.source)
        on conflict do nothing;
    end loop;

    update stuart_scan_error set cleared_at = now()
    where book_id = p_book_id and cleared_at is null;

    perform _carry_pull_list_meta(
        v_book.series, v_book.volume, v_book.publisher,
        v_sv.name, coalesce(v_sv.start_year::text, ''), coalesce(v_sv.publisher, '')
    );
end;
$$;

-- Record that every adapter failed for a book. The book is not retried for a
-- week, and at most 3 times in total, unless its fields change.
create or replace function public.stuart_record_book_failure(
    p_run_id bigint,
    p_book_id integer,
    p_errors jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_book book%rowtype;
    v_err jsonb;
begin
    select * into v_book from book where book_id = p_book_id for update;
    if not found then
        return;
    end if;

    update stuart_scan_error set cleared_at = now()
    where book_id = p_book_id and cleared_at is null;

    for v_err in select jsonb_array_elements(coalesce(p_errors, '[]'::jsonb))
    loop
        insert into stuart_scan_error (
            run_id, book_id, series, volume, publisher, number, adapter, code, message, details
        ) values (
            p_run_id, p_book_id, v_book.series, v_book.volume, v_book.publisher, v_book.number,
            coalesce(v_err->>'adapter', 'unknown'),
            coalesce(v_err->>'code', 'error'),
            coalesce(v_err->>'message', 'Unknown error'),
            v_err->'details'
        );
    end loop;

    perform set_config('stuart.applying', 'on', true);
    update book
    set scan_state = 'failed',
        scan_attempts = scan_attempts + 1,
        last_scanned_at = now(),
        next_scan_after = now() + interval '7 days'
    where book_id = p_book_id;
    perform set_config('stuart.applying', 'off', true);
end;
$$;

revoke all on function
    public._carry_pull_list_meta(text, text, text, text, text, text),
    public.stuart_pending_books(integer),
    public.stuart_pending_count(),
    public.stuart_known_volume(text, text, text),
    public.stuart_upsert_series_volume(jsonb),
    public.stuart_apply_book_match(integer, bigint, text, date, jsonb),
    public.stuart_record_book_failure(bigint, integer, jsonb)
from public, anon, authenticated;

grant execute on function
    public.stuart_pending_books(integer),
    public.stuart_pending_count(),
    public.stuart_known_volume(text, text, text),
    public.stuart_upsert_series_volume(jsonb),
    public.stuart_apply_book_match(integer, bigint, text, date, jsonb),
    public.stuart_record_book_failure(bigint, integer, jsonb)
to service_role;

notify pgrst, 'reload schema';

commit;
