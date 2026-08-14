-- ═══════════════════════════════════════════════════════════════════════════
--  Everything saves — being signed in is enough
--
--  Run this once in the Supabase SQL editor, after 0001 and 0002. It is
--  idempotent, so re-running is harmless.
--
--  THE PROBLEM
--
--  Up to now the database only held a reading if you were in a pair. Signing
--  in gave you an account and nothing to write to, so a reader who had not yet
--  created or joined a group kept their whole history on one phone — and lost
--  it with the phone. "Signed in" looked like "saved" and was not.
--
--  THE FIX
--
--  A group of one is still a group. ensure_pair() returns the pair you are in,
--  creating a private one for you if you are in none, so a store exists from
--  the moment you sign in. Sharing is then what it always should have been: an
--  invitation to a history that already exists, rather than the act that makes
--  one.
--
--  That raises a question 0001 did not have to answer — which pair is mine,
--  when I am in two? my_pair() ordered by join date, so a private pair made at
--  sign-up would have permanently shadowed a group joined the day after. Two
--  things settle it:
--
--    * my_pair_id() prefers the pair with the most members, so a real group
--      always wins over a store of one.
--    * join_pair() folds your private pair into the group you are joining —
--      readings and all — and then deletes it, so there is nothing left to be
--      ambiguous about and nothing you read alone is lost by joining.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0002 introduced profiles and notes_by, and this builds on both. Fail here,
-- loudly and before anything is changed, rather than at three in the morning
-- when someone's note will not save.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Run 0002_real_readers.sql first — this migration builds on it.';
  end if;
end
$$;

-- ── my_pair_id(): one answer to "which pair is mine" ──────────────────────
-- Everything that used to inline this ordering now calls it, so the roster and
-- the history can never disagree about which pair they are describing.

create or replace function public.my_pair_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m.pair_id
  from public.pair_members m
  where m.user_id = auth.uid()
  order by (select count(*) from public.pair_members x where x.pair_id = m.pair_id) desc,
           m.created_at
  limit 1;
$$;

revoke all on function public.my_pair_id() from public, anon;
grant execute on function public.my_pair_id() to authenticated;

-- ── merge_notes(): two per-author note maps into one ──────────────────────
-- Each key belongs to one person, so a key only one side has is simply taken.
-- Where the same author has written on both sides the longer text wins, which
-- is the rule the client already uses when it has no timestamps to go on.
-- Never concatenate: that turns two drafts of a thought into one unreadable
-- one.

create or replace function public.merge_notes(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(
      k,
      case when length(coalesce(b ->> k, '')) > length(coalesce(a ->> k, ''))
           then b -> k
           else coalesce(a -> k, b -> k)
      end
    ),
    '{}'::jsonb
  )
  from jsonb_object_keys(coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb)) as k;
$$;

-- ── absorb_pair(): fold one pair's history into another ───────────────────
--
--  Deliberately NOT granted to anyone. It is SECURITY DEFINER and takes two
--  pair ids, so a client able to call it could copy readings between groups it
--  has nothing to do with. join_pair() is definer and owned by the same role,
--  so it can call this; nothing else can.
--
--  The row-level rules match src/lib/merge.js, because the two have to agree:
--  the earliest date it was drawn, every tick from both sides, and the longer
--  note where both have one.

create or replace function public.absorb_pair(p_from uuid, p_into uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  insert into public.readings as t (pair_id, entry_id, date_iso, notes, notes_by, read_by)
  select p_into, r.entry_id, r.date_iso, r.notes, r.notes_by, r.read_by
  from public.readings r
  where r.pair_id = p_from
  on conflict (pair_id, entry_id) do update
    set date_iso = least(t.date_iso, excluded.date_iso),
        notes    = case when length(coalesce(excluded.notes, '')) > length(coalesce(t.notes, ''))
                        then excluded.notes else t.notes end,
        notes_by = public.merge_notes(t.notes_by, excluded.notes_by),
        read_by  = (select coalesce(array_agg(distinct e), '{}'::text[])
                    from unnest(t.read_by || excluded.read_by) as e);
$$;

revoke all on function public.absorb_pair(uuid, uuid) from public, anon, authenticated;

-- ── ensure_pair(): signing in is enough ───────────────────────────────────
-- Same shape as my_pair(), so the client can call this everywhere it called
-- that. The advisory lock is per user and held to the end of the transaction:
-- two tabs opening at once would otherwise both find nothing and both create a
-- pair, and the loser's readings would go somewhere nobody looks again.

create or replace function public.ensure_pair()
returns table (
  pair_id uuid,
  invite_code text,
  member_count integer,
  last_spin_date date,
  readers jsonb
)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = 'PT401';
  end if;

  v_id := public.my_pair_id();

  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('ensure_pair:' || auth.uid()::text));
    v_id := public.my_pair_id();          -- re-read: the other tab may have won
    if v_id is null then
      insert into public.pairs (invite_code)
      values (public.new_invite_code())
      returning id into v_id;
      insert into public.pair_members (pair_id, user_id) values (v_id, auth.uid());
    end if;
  end if;

  -- A reader is an account, so the roster row exists from now rather than from
  -- whenever this person next edits their name.
  insert into public.profiles (user_id, display_name)
  values (auth.uid(), '')
  on conflict (user_id) do nothing;

  return query
    select p.id,
           p.invite_code,
           (select count(*)::int from public.pair_members x where x.pair_id = p.id),
           p.last_spin_date,
           p.readers
    from public.pairs p
    where p.id = v_id;
end;
$$;

revoke all on function public.ensure_pair() from public, anon;
grant execute on function public.ensure_pair() to authenticated;

-- ── my_pair(): unchanged in shape, now agreeing with everything else ──────

create or replace function public.my_pair()
returns table (
  pair_id uuid,
  invite_code text,
  member_count integer,
  last_spin_date date,
  readers jsonb
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.id,
         p.invite_code,
         (select count(*)::int from public.pair_members x where x.pair_id = p.id),
         p.last_spin_date,
         p.readers
  from public.pairs p
  where p.id = public.my_pair_id();
$$;

revoke all on function public.my_pair() from public, anon;
grant execute on function public.my_pair() to authenticated;

-- ── pair_readers(): same, so the roster describes the same pair ───────────

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
  where m.pair_id = public.my_pair_id()
  order by m.created_at;
$$;

revoke all on function public.pair_readers() from public, anon;
grant execute on function public.pair_readers() to authenticated;

-- ── create_pair(): share the store you already have ───────────────────────
--
--  With ensure_pair() in place, everybody signed in already has a pair, so
--  "start a shared history" is no longer an act of creation — it is asking for
--  the code to the history you have been writing all along. Making a second
--  one would strand the first, which is the exact failure this migration
--  exists to remove.
--
--  Kept because the client still calls it on a project where the button is
--  reachable. It is now ensure_pair() with a narrower result.

create or replace function public.create_pair(p_name text default null)
returns table (pair_id uuid, invite_code text)
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  select e.pair_id, e.invite_code from public.ensure_pair() e;
$$;

revoke all on function public.create_pair(text) from public, anon;
grant execute on function public.create_pair(text) to authenticated;

-- ── join_pair(): bring your own history with you ──────────────────────────

create or replace function public.join_pair(p_code text, p_name text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_pair_id uuid;
  v_count   integer;
  v_solo    uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = 'PT401';
  end if;

  select id into v_pair_id
  from public.pairs
  where invite_code = upper(trim(p_code));

  if v_pair_id is null then
    raise exception 'No group has that code. Check it and try again.' using errcode = 'PT404';
  end if;

  -- Already in it: joining again is a no-op rather than an error.
  if exists (select 1 from public.pair_members m
             where m.pair_id = v_pair_id and m.user_id = auth.uid()) then
    return v_pair_id;
  end if;

  select count(*) into v_count from public.pair_members m where m.pair_id = v_pair_id;
  if v_count >= 8 then
    raise exception 'That group already has eight readers.' using errcode = 'PT409';
  end if;

  insert into public.pair_members (pair_id, user_id) values (v_pair_id, auth.uid());

  -- Any pair where you are now the only member is a private store. Fold it in
  -- and drop it: everything you read before joining belongs to the group you
  -- have joined, and leaving it behind is how a history quietly disappears.
  for v_solo in
    select m.pair_id
    from public.pair_members m
    where m.user_id = auth.uid()
      and m.pair_id <> v_pair_id
      and (select count(*) from public.pair_members x where x.pair_id = m.pair_id) = 1
  loop
    perform public.absorb_pair(v_solo, v_pair_id);
    delete from public.pairs where id = v_solo;   -- cascades members and readings
  end loop;

  return v_pair_id;
end;
$$;

revoke all on function public.join_pair(text, text) from public, anon;
grant execute on function public.join_pair(text, text) to authenticated;

-- ── give everyone already here a store ────────────────────────────────────
-- Accounts that signed up before this migration have no pair at all, and their
-- reading is sitting on one phone. This gives each of them a private pair now,
-- so the next time they open the app there is somewhere for it to go.

do $$
declare
  u record;
  v_id uuid;
begin
  for u in
    select id from auth.users
    where not exists (select 1 from public.pair_members m where m.user_id = auth.users.id)
  loop
    insert into public.pairs (invite_code)
    values (public.new_invite_code())
    returning id into v_id;
    insert into public.pair_members (pair_id, user_id) values (v_id, u.id);
    insert into public.profiles (user_id, display_name) values (u.id, '')
    on conflict (user_id) do nothing;
  end loop;
end
$$;
