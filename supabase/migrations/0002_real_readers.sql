-- ═══════════════════════════════════════════════════════════════════════════
--  Real readers, and a note each
--
--  Run this once in the Supabase SQL editor, after 0001. It is idempotent, so
--  re-running is harmless.
--
--  Two things change.
--
--  1. THE ROSTER COMES FROM THE DATABASE.
--
--     0001 kept the reader list in pairs.readers, a jsonb document each client
--     rewrote wholesale. That works only while every device is pushing: if
--     Edith joins the group and does not open the app for a day, nobody else
--     can see her, because nothing has written her row. And every client
--     overwriting the same document means one stale phone can undo a name
--     change made on another.
--
--     Membership already lives in pair_members, which is the truth. So this
--     adds a profiles table for the parts a person owns about themselves —
--     their display name and their photo — and a pair_readers() function that
--     joins the two. The roster is now a query against real accounts, and
--     somebody appears the moment they join rather than the moment their phone
--     next syncs.
--
--     Crucially, you can only ever write your OWN profile. Under the old
--     scheme anybody in the group could rewrite anybody's name, because it was
--     all one document.
--
--  2. EACH READER GETS THEIR OWN NOTE.
--
--     readings.notes is a single shared box, so two people writing about the
--     same passage overwrite each other. readings.notes_by is a jsonb map from
--     user id to that person's own note. The old column stays and is still
--     shown where it has content, so nothing already written is lost.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles: the part of a reader they own themselves ────────────────────

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- SECURITY DEFINER for the same reason is_pair_member() is: answering "are we
-- in a group together" must not itself require reading a table the asker may
-- not be allowed to read.
create or replace function public.shares_pair_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p_user = auth.uid() or exists (
    select 1
    from public.pair_members mine
    join public.pair_members theirs on theirs.pair_id = mine.pair_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;

revoke all on function public.shares_pair_with(uuid) from public, anon;
grant execute on function public.shares_pair_with(uuid) to authenticated;

-- You can read the profile of anyone you share a group with. You can write
-- exactly one profile: your own.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.shares_pair_with(user_id));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

grant select, insert, update on public.profiles to authenticated;

-- ── pair_readers(): the group, as it actually is ──────────────────────────
-- SECURITY DEFINER because the email lives in auth.users, which no client role
-- may read directly. Only members of your own pair are ever returned.

create or replace function public.pair_readers()
returns table (
  user_id      uuid,
  email        text,
  display_name text,
  avatar_url   text,
  joined_at    timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m.user_id,
         u.email::text,
         coalesce(p.display_name, ''),
         p.avatar_url,
         m.created_at
  from public.pair_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.pair_id = (
    select mine.pair_id
    from public.pair_members mine
    where mine.user_id = auth.uid()
    order by mine.created_at
    limit 1
  )
  order by m.created_at;
$$;

revoke all on function public.pair_readers() from public, anon;
grant execute on function public.pair_readers() to authenticated;

-- ── a note each ───────────────────────────────────────────────────────────
-- { "<user id>": "their note" }. The existing shared notes column is left
-- alone: it still holds whatever was written before this migration, and the
-- app shows it where it is not empty.

alter table public.readings
  add column if not exists notes_by jsonb not null default '{}'::jsonb;

-- ── realtime, so a name or a note reaches the other phone ─────────────────

alter table public.profiles replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.profiles;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;

-- ── seed a profile row for everyone already here ──────────────────────────
-- So an existing group is complete the moment this runs, rather than each
-- person having to open the app first.

insert into public.profiles (user_id, display_name)
select distinct m.user_id, ''
from public.pair_members m
on conflict (user_id) do nothing;
