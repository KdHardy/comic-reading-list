-- Cache cover art bytes on the book row after the web app lazy-loads them.
alter table book
    add column if not exists thumbnail_data bytea,
    add column if not exists thumbnail_mime text,
    add column if not exists thumbnail_cached_at timestamptz;

create or replace function save_book_thumbnail(
    p_secret          text,
    p_book_id         integer,
    p_thumbnail_data  text,
    p_thumbnail_mime  text default 'image/jpeg'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform _check_secret(p_secret);

    if not exists (select 1 from book where book_id = p_book_id) then
        raise exception 'book % not found', p_book_id;
    end if;

    if p_thumbnail_data is null or length(p_thumbnail_data) = 0 then
        raise exception 'thumbnail data cannot be empty';
    end if;

    update book
    set thumbnail_data = decode(p_thumbnail_data, 'base64'),
        thumbnail_mime = nullif(btrim(coalesce(p_thumbnail_mime, '')), ''),
        thumbnail_cached_at = now()
    where book_id = p_book_id;
end;
$$;
