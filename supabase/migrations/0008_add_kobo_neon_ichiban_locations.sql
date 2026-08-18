-- Add Kobo and Neon Ichiban to the location lookup table.
insert into location (location_name) values
    ('Kobo'),
    ('Neon Ichiban')
on conflict (location_name) do nothing;
