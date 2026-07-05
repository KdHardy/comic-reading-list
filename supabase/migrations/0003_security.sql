-- Comic Reading List — Row Level Security
--
-- Public read access (the app has no login), but no direct writes: every
-- mutation must go through the secret-checked RPC functions in
-- 0002_functions.sql instead. Those functions are SECURITY DEFINER and run
-- as the table owner, so they bypass these policies — direct REST calls do not.

alter table location      enable row level security;
alter table reading_list  enable row level security;
alter table book          enable row level security;
alter table reading_order enable row level security;
alter table app_secret    enable row level security;
-- No policies are created on app_secret, so it has zero access via the REST
-- API for any role — intentional, it's only ever read from inside functions.

create policy "public read access" on location
    for select using (true);

create policy "public read access" on reading_list
    for select using (true);

create policy "public read access" on book
    for select using (true);

create policy "public read access" on reading_order
    for select using (true);
