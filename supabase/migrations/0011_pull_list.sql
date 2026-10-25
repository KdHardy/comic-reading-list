-- Pull List: per-series metadata layered over the books already on lists.
--
-- A series is identified the same way books are deduplicated: by
-- (series, volume, publisher), with NULL volume/publisher normalized to ''.
-- Issue totals and read counts are derived from list_entry + book at read
-- time, so this table only stores what the user chooses: family, status,
-- priority order, and which cover (and crop of it) supplies the title art.
-- Rows are created lazily by the RPCs below the first time a series is edited.

begin;

create table if not exists public.pull_list_series (
    pull_list_series_id  bigserial primary key,
    series               text not null check (btrim(series) <> ''),
    volume               text not null default '',
    publisher            text not null default '',
    family               text,
    status               text check (status in ('read_all', 'maybe', 'skip')),
    sort_order           integer,
    title_art_book_id    integer references public.book (book_id) on delete set null,
    -- Title art crop rectangle as fractions (0–1) of the cover's width/height.
    title_art_x          real,
    title_art_y          real,
    title_art_w          real,
    title_art_h          real,
    updated_at           timestamptz not null default now(),
    unique (series, volume, publisher),
    constraint pull_list_series_crop_check check (
        (
            title_art_x is null and title_art_y is null
            and title_art_w is null and title_art_h is null
        )
        or
        (
            title_art_x >= 0 and title_art_y >= 0
            and title_art_w > 0 and title_art_h > 0
            and title_art_x + title_art_w <= 1.0001
            and title_art_y + title_art_h <= 1.0001
        )
    )
);

alter table public.pull_list_series enable row level security;

revoke insert, update, delete, truncate, references, trigger
    on table public.pull_list_series from anon, authenticated;
grant select on table public.pull_list_series to anon, authenticated;
grant all on table public.pull_list_series to service_role;

drop policy if exists "public read access" on public.pull_list_series;
create policy "public read access"
    on public.pull_list_series
    for select
    to anon, authenticated
    using (true);

-- Find-or-create the metadata row for a series and return its id.
create or replace function public._ensure_pull_list_series(
    p_series text,
    p_volume text,
    p_publisher text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
begin
    if btrim(coalesce(p_series, '')) = '' then
        raise exception 'series cannot be blank';
    end if;

    insert into pull_list_series (series, volume, publisher)
    values (p_series, coalesce(p_volume, ''), coalesce(p_publisher, ''))
    on conflict (series, volume, publisher) do nothing;

    select pull_list_series_id into v_id
    from pull_list_series
    where series = p_series
      and volume = coalesce(p_volume, '')
      and publisher = coalesce(p_publisher, '');

    return v_id;
end;
$$;

revoke all on function public._ensure_pull_list_series(text, text, text) from public, anon, authenticated;

create or replace function public.set_pull_list_series_status(
    p_secret text,
    p_series text,
    p_volume text,
    p_publisher text,
    p_status text
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

    if p_status is not null and p_status not in ('read_all', 'maybe', 'skip') then
        raise exception 'invalid pull list status %', p_status;
    end if;

    v_id := _ensure_pull_list_series(p_series, p_volume, p_publisher);
    update pull_list_series
    set status = p_status,
        updated_at = now()
    where pull_list_series_id = v_id;
end;
$$;

create or replace function public.set_pull_list_series_family(
    p_secret text,
    p_series text,
    p_volume text,
    p_publisher text,
    p_family text
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

    v_id := _ensure_pull_list_series(p_series, p_volume, p_publisher);
    update pull_list_series
    set family = nullif(btrim(coalesce(p_family, '')), ''),
        updated_at = now()
    where pull_list_series_id = v_id;
end;
$$;

-- Pass p_book_id = null to clear the title art (and its crop).
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
        from book
        where book_id = p_book_id
          and series = p_series
          and coalesce(volume, '') = coalesce(p_volume, '')
          and coalesce(publisher, '') = coalesce(p_publisher, '')
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

-- Persist the priority order. p_series_keys is a JSON array of
-- {series, volume, publisher} objects in the desired order; series missing
-- from the array keep their existing sort_order.
create or replace function public.reorder_pull_list_series(
    p_secret text,
    p_series_keys jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_key jsonb;
    v_id bigint;
    v_order integer := 10;
begin
    perform _check_secret(p_secret);

    if jsonb_typeof(coalesce(p_series_keys, '[]'::jsonb)) <> 'array' then
        raise exception 'series keys must be a JSON array';
    end if;

    for v_key in select jsonb_array_elements(coalesce(p_series_keys, '[]'::jsonb))
    loop
        v_id := _ensure_pull_list_series(
            v_key->>'series',
            v_key->>'volume',
            v_key->>'publisher'
        );
        update pull_list_series
        set sort_order = v_order,
            updated_at = now()
        where pull_list_series_id = v_id;
        v_order := v_order + 10;
    end loop;
end;
$$;

revoke all on function
    public.set_pull_list_series_status(text, text, text, text, text),
    public.set_pull_list_series_family(text, text, text, text, text),
    public.set_pull_list_series_title_art(text, text, text, text, integer, real, real, real, real),
    public.reorder_pull_list_series(text, jsonb)
from public;

grant execute on function
    public.set_pull_list_series_status(text, text, text, text, text),
    public.set_pull_list_series_family(text, text, text, text, text),
    public.set_pull_list_series_title_art(text, text, text, text, integer, real, real, real, real),
    public.reorder_pull_list_series(text, jsonb)
to anon, authenticated;

notify pgrst, 'reload schema';

commit;
