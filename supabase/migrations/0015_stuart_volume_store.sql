-- Stuart: local store of looked-up volumes and their issues.
--
-- Volume details and issue dates almost never change once published, so
-- Stuart checks its own copy before calling ComicVine:
--   * series_volume gains first_issue_number and two sync timestamps:
--     details_synced_at (details fetched from the source; refreshed after 30
--     days only while the run is ongoing) and issues_synced_at (issue list
--     fetched; null = never).
--   * series_volume_issue stores each volume's issues (number, store/cover
--     date) and, once fetched, the issue's story arcs.

begin;

alter table public.series_volume
    add column if not exists first_issue_number text,
    add column if not exists details_synced_at timestamptz,
    add column if not exists issues_synced_at timestamptz;

-- Existing rows were fetched when they were last updated.
update public.series_volume set details_synced_at = updated_at where details_synced_at is null;

create table if not exists public.series_volume_issue (
    series_volume_id      bigint not null references public.series_volume (series_volume_id) on delete cascade,
    source_issue_id       text not null,
    issue_number          text,
    store_date            date,
    cover_date            date,
    -- [{source_id, name, site_url, publisher?, issue_count?}]; null = not fetched yet.
    storylines            jsonb,
    storylines_synced_at  timestamptz,
    primary key (series_volume_id, source_issue_id)
);

-- Stuart's working data: service role only (no policy, so not reachable over REST).
alter table public.series_volume_issue enable row level security;
revoke all on table public.series_volume_issue from anon, authenticated;
grant all on table public.series_volume_issue to service_role;

-- p_volume as before, plus optional first_issue_number and the flags
-- details_synced / issues_synced (true when just fetched from the source).
-- Sync timestamps are only ever moved forward.
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
        first_issue_number, last_issue_number, last_issue_date, is_ongoing, site_url,
        details_synced_at, issues_synced_at, updated_at
    ) values (
        coalesce(p_volume->>'source', 'comicvine'),
        p_volume->>'source_id',
        p_volume->>'name',
        (p_volume->>'start_year')::integer,
        p_volume->>'publisher',
        (p_volume->>'count_of_issues')::integer,
        p_volume->>'first_issue_number',
        p_volume->>'last_issue_number',
        (p_volume->>'last_issue_date')::date,
        (p_volume->>'is_ongoing')::boolean,
        p_volume->>'site_url',
        case when coalesce((p_volume->>'details_synced')::boolean, false) then now() end,
        case when coalesce((p_volume->>'issues_synced')::boolean, false) then now() end,
        now()
    )
    on conflict (source, source_id) do update
    set name = excluded.name,
        start_year = excluded.start_year,
        publisher = excluded.publisher,
        count_of_issues = excluded.count_of_issues,
        first_issue_number = coalesce(excluded.first_issue_number, series_volume.first_issue_number),
        last_issue_number = excluded.last_issue_number,
        last_issue_date = excluded.last_issue_date,
        is_ongoing = excluded.is_ongoing,
        site_url = excluded.site_url,
        details_synced_at = coalesce(excluded.details_synced_at, series_volume.details_synced_at),
        issues_synced_at = coalesce(excluded.issues_synced_at, series_volume.issues_synced_at),
        updated_at = now()
    returning series_volume_id into v_id;

    return v_id;
end;
$$;

-- Replace a volume's stored issue list, keeping story arcs already fetched
-- for issues that are still there.
-- p_issues: [{source_issue_id, issue_number, store_date, cover_date}]
create or replace function public.stuart_replace_volume_issues(p_series_volume_id bigint, p_issues jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into series_volume_issue (series_volume_id, source_issue_id, issue_number, store_date, cover_date)
    select p_series_volume_id,
           i->>'source_issue_id',
           i->>'issue_number',
           (i->>'store_date')::date,
           (i->>'cover_date')::date
    from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb)) i
    on conflict (series_volume_id, source_issue_id) do update
    set issue_number = excluded.issue_number,
        store_date = excluded.store_date,
        cover_date = excluded.cover_date;

    delete from series_volume_issue s
    where s.series_volume_id = p_series_volume_id
      and not exists (
          select 1 from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb)) i
          where i->>'source_issue_id' = s.source_issue_id
      );

    update series_volume set issues_synced_at = now() where series_volume_id = p_series_volume_id;
end;
$$;

revoke all on function public.stuart_replace_volume_issues(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.stuart_replace_volume_issues(bigint, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
