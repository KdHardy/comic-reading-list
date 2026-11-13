-- Stuart: nightly scheduling.
--
-- pg_cron calls stuart_tick() every 30 minutes during the UTC hours that can
-- contain the configured local window (default 00:00–06:00 America/Los_Angeles).
-- stuart_tick() only calls the Edge Function when:
--   * it is the first half hour of the window and books are waiting to be
--     scanned (i.e. comics were added or changed since the last scan), or
--   * a nightly run already started tonight and books are still waiting
--     (each call scans a rate-limited batch; ComicVine allows ~200 requests
--     per resource per hour).
-- Nights with no new comics make no calls at all.
--
-- After applying, point Stuart at the deployed function (once per project):
--   update stuart_config set function_url = 'https://<project-ref>.supabase.co/functions/v1/stuart';

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.stuart_tick()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_config stuart_config%rowtype;
    v_local timestamp;
    v_hour integer;
    v_window_start timestamptz;
    v_pending integer;
    v_started_tonight boolean;
    v_running boolean;
    v_secret text;
begin
    select * into v_config from stuart_config where singleton;
    if not found or not v_config.enabled then
        return 'disabled';
    end if;
    if v_config.function_url is null then
        return 'no function_url configured';
    end if;

    v_local := now() at time zone v_config.timezone;
    v_hour := extract(hour from v_local)::integer;
    if v_hour < v_config.window_start_hour or v_hour >= v_config.window_end_hour then
        return 'outside window';
    end if;

    v_pending := stuart_pending_count();
    if v_pending = 0 then
        return 'nothing to scan';
    end if;

    v_window_start := (date_trunc('day', v_local) + make_interval(hours => v_config.window_start_hour))
                      at time zone v_config.timezone;

    select exists (
        select 1 from stuart_run
        where trigger = 'nightly' and started_at >= v_window_start
    ) into v_started_tonight;

    -- A batch from the previous tick may still be running.
    select exists (
        select 1 from stuart_run
        where status = 'running' and started_at > now() - interval '10 minutes'
    ) into v_running;
    if v_running then
        return 'previous batch still running';
    end if;

    -- A fatal error (e.g. a bad API key) stops the rest of tonight's batches.
    if exists (
        select 1 from stuart_run
        where trigger = 'nightly' and started_at >= v_window_start and status = 'failed'
    ) then
        return 'stopped after a failed batch tonight';
    end if;

    if not v_started_tonight
       and v_local >= (date_trunc('day', v_local) + make_interval(hours => v_config.window_start_hour, mins => 30)) then
        return 'no run started in the first half hour';
    end if;

    select secret into v_secret from app_secret limit 1;

    perform net.http_post(
        url := v_config.function_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-stuart-secret', v_secret
        ),
        body := jsonb_build_object('trigger', 'nightly'),
        timeout_milliseconds := 150000
    );

    return format('started batch (%s books waiting)', v_pending);
end;
$$;

revoke all on function public.stuart_tick() from public, anon, authenticated;

-- Every 30 minutes from 07:00 to 14:30 UTC covers 00:00–06:00 Pacific in both
-- standard and daylight time; stuart_tick() checks the local window itself.
do $$
begin
    if exists (select 1 from cron.job where jobname = 'stuart-nightly') then
        perform cron.unschedule('stuart-nightly');
    end if;
    perform cron.schedule('stuart-nightly', '*/30 7-14 * * *', 'select public.stuart_tick()');
end $$;
