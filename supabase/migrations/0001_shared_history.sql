-- ═══════════════════════════════════════════════════════════════════════════
--  The Spin Catalog — shared reading history
--
--  One shared history for a small group — two people, or up to eight. Each
--  signs in with a magic link; one creates the group and shares its invite
--  code, the others join with it. From then on every device reads and writes
--  the same rows.
--
--  Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
--  query → paste → Run). It is idempotent, so re-running is harmless.
--
--  Security model
--  --------------
--  Every table is RLS-protected and every policy resolves through
--  public.is_pair_member(), which is SECURITY DEFINER so that checking your
--  membership does not itself require reading a table you may not be allowed
--  to read. Nothing is world-readable: a signed-out client sees nothing, and
--  a signed-in client sees only the pair it belongs to.
--
--  The invite code is a bearer secret, so joining goes through a
--  SECURITY DEFINER function rather than a SELECT policy — the codes table is
--  never directly readable, which means codes cannot be enumerated or brute
--  forced by listing.
--
--  Error codes use PostgREST's PTnnn convention so a mistyped invite code
--  arrives at the client as a 404 with a readable message, rather than as a
--  generic 500.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── pairs ─────────────────────────────────────────────────────────────────

create table if not exists public.pairs (
  id              uuid primary key default gen_random_uuid(),
  invite_code     text not null unique,
  last_spin_date  date,
  -- The reader roster, in the same shape the client holds it:
  -- [{ id, name, avatarUrl, userId, email }]. The access pattern is always
  -- "read this pair's whole state", so a document beats three joins here.
  readers         jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.pair_members (
  pair_id    uuid not null references public.pairs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pair_id, user_id)
);

create index if not exists pair_members_user_idx on public.pair_members(user_id);

-- ── readings: one row per catalog entry, per pair ─────────────────────────

create table if not exists public.readings (
  pair_id    uuid not null references public.pairs(id) on delete cascade,
  entry_id   integer not null check (entry_id > 0),
  date_iso   date,
  notes      text not null default '',
  -- Reader ids, matching pairs.readers[].id.
  read_by    text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (pair_id, entry_id)
);

create index if not exists readings_pair_date_idx on public.readings(pair_id, date_iso desc);

-- ── membership check ──────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can call it without recursing into the RLS on
-- pair_members itself.

create or replace function public.is_pair_member(p_pair uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.pair_members m
    where m.pair_id = p_pair and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_pair_member(uuid) from public, anon;
grant execute on function public.is_pair_member(uuid) to authenticated;

-- ── row level security ────────────────────────────────────────────────────

alter table public.pairs        enable row level security;
alter table public.pair_members enable row level security;
alter table public.readings     enable row level security;

drop policy if exists pairs_select on public.pairs;
create policy pairs_select on public.pairs
  for select to authenticated
  using (public.is_pair_member(id));

drop policy if exists pairs_update on public.pairs;
create policy pairs_update on public.pairs
  for update to authenticated
  using (public.is_pair_member(id))
  with check (public.is_pair_member(id));

drop policy if exists members_select on public.pair_members;
create policy members_select on public.pair_members
  for select to authenticated
  using (public.is_pair_member(pair_id));

-- Leaving a pair is allowed; adding yourself is not — that is what
-- join_pair() is for, so the invite code is always checked.
drop policy if exists members_delete_self on public.pair_members;
create policy members_delete_self on public.pair_members
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists readings_all on public.readings;
create policy readings_all on public.readings
  for all to authenticated
  using (public.is_pair_member(pair_id))
  with check (public.is_pair_member(pair_id));

-- ── invite codes ──────────────────────────────────────────────────────────
-- Crockford base32 without I, L, O, U: no character pairs that get misread or
-- mistyped when one of you reads a code aloud to the other.

create or replace function public.new_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  code text;
  i integer;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.pairs p where p.invite_code = code);
  end loop;
  return code;
end;
$$;

-- ── create_pair(): start a new shared history ─────────────────────────────

create or replace function public.create_pair(p_name text default null)
returns table (pair_id uuid, invite_code text)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_pair public.pairs;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = 'PT401';
  end if;

  insert into public.pairs (invite_code)
  values (public.new_invite_code())
  returning * into v_pair;

  insert into public.pair_members (pair_id, user_id) values (v_pair.id, auth.uid());

  return query select v_pair.id, v_pair.invite_code;
end;
$$;

revoke all on function public.create_pair(text) from public, anon;
grant execute on function public.create_pair(text) to authenticated;

-- ── join_pair(): the other person, with the code ──────────────────────────
-- SECURITY DEFINER so the code can be checked without pairs ever being
-- readable by a non-member.

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
  return v_pair_id;
end;
$$;

revoke all on function public.join_pair(text, text) from public, anon;
grant execute on function public.join_pair(text, text) to authenticated;

-- ── my_pair(): what am I in, and what is its code ─────────────────────────

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
  select p.id, p.invite_code,
         (select count(*)::int from public.pair_members x where x.pair_id = p.id),
         p.last_spin_date, p.readers
  from public.pair_members m
  join public.pairs p on p.id = m.pair_id
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$$;

revoke all on function public.my_pair() from public, anon;
grant execute on function public.my_pair() to authenticated;

-- ── keep updated_at honest ────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists readings_touch on public.readings;
create trigger readings_touch before update on public.readings
  for each row execute function public.touch_updated_at();

drop trigger if exists pairs_touch on public.pairs;
create trigger pairs_touch before update on public.pairs
  for each row execute function public.touch_updated_at();

-- ── table grants (RLS still applies on top) ───────────────────────────────

grant usage on schema public to authenticated;
grant select, update on public.pairs to authenticated;
grant select, delete on public.pair_members to authenticated;
grant select, insert, update, delete on public.readings to authenticated;

-- ── realtime, so the other phone updates without a refresh ────────────────

alter table public.readings replica identity full;
alter table public.pairs    replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.readings;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.pairs;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;

-- ── avatars ───────────────────────────────────────────────────────────────
-- Public read so a photo renders for the other readers without a signed URL;
-- writes are confined to a folder named after your own user id, so nobody can
-- overwrite anyone else's picture.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
