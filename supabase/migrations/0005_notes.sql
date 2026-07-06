-- Comic Reading List — Notes
--
-- One-to-many free-text notes per book (e.g. reading tips, links to reviews,
-- reminders). Notes are book-level, not list-level, since a book has one
-- canonical set of notes regardless of which reading list(s) it appears on.

create table if not exists note (
    note_id     serial primary key,
    book_id     integer not null references book (book_id) on delete cascade,
    note_text   text not null check (btrim(note_text) <> ''),
    created_at  timestamptz not null default now()
);

create index if not exists idx_note_book on note (book_id, created_at);

alter table note enable row level security;

create policy "public read access" on note
    for select using (true);

-- Add a note to a book, returns the new note_id.
create or replace function add_note(p_secret text, p_book_id integer, p_note_text text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_note_id integer;
begin
    perform _check_secret(p_secret);

    if btrim(coalesce(p_note_text, '')) = '' then
        raise exception 'note text cannot be blank';
    end if;

    insert into note (book_id, note_text) values (p_book_id, btrim(p_note_text))
    returning note_id into v_note_id;

    return v_note_id;
end;
$$;

-- Edit an existing note's text.
create or replace function update_note(p_secret text, p_note_id integer, p_note_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform _check_secret(p_secret);

    if btrim(coalesce(p_note_text, '')) = '' then
        raise exception 'note text cannot be blank';
    end if;

    update note set note_text = btrim(p_note_text) where note_id = p_note_id;
end;
$$;

-- Remove a note entirely (used when the user clears a note's text to blank
-- while editing, since there's no separate delete button in the UI).
create or replace function delete_note(p_secret text, p_note_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform _check_secret(p_secret);

    delete from note where note_id = p_note_id;
end;
$$;

grant execute on function
    add_note(text, integer, text),
    update_note(text, integer, text),
    delete_note(text, integer)
to anon, authenticated;
