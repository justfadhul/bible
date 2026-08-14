do $$
begin
  if to_regprocedure('public.my_pair_id()') is null then
    raise exception 'Run 0003_everything_saves.sql first — this migration builds on it.';
  end if;
end
$$;

/* ── friendships ─────────────────────────────────────────────────────────── */

create table if not exists public.friendships (
  user_low     uuid not null references auth.users(id) on delete cascade,
  user_high    uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint friendships_ordered   check (user_low < user_high),
  constraint friendships_status    check (status in ('pending', 'accepted')),
  constraint friendships_requester check (requested_by in (user_low, user_high))
);

create index if not exists friendships_high_idx on public.friendships(user_high);

alter table public.friendships enable row level security;

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (user_low = auth.uid() or user_high = auth.uid());

revoke all on public.friendships from public, anon, authenticated;
grant select on public.friendships to authenticated;

drop trigger if exists friendships_touch on public.friendships;
create trigger friendships_touch before update on public.friendships
  for each row execute function public.touch_updated_at();

/* ── presence ────────────────────────────────────────────────────────────── */

create table if not exists public.presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.presence enable row level security;
revoke all on public.presence from public, anon, authenticated;

/* ── helpers ─────────────────────────────────────────────────────────────── */

create or replace function public.pair_id_for(p_user uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select m.pair_id
  from public.pair_members m
  where m.user_id = p_user
  order by (select count(*) from public.pair_members x where x.pair_id = m.pair_id) desc,
           m.created_at
  limit 1;
$$;

revoke all on function public.pair_id_for(uuid) from public, anon, authenticated;

create or replace function public.my_pair_id()
returns uuid
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select public.pair_id_for(auth.uid());
$$;

revoke all on function public.my_pair_id() from public, anon;
grant execute on function public.my_pair_id() to authenticated;

create or replace function public.are_friends(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select public.shares_pair_with(p_user) or exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and f.user_low  = least(auth.uid(), p_user)
      and f.user_high = greatest(auth.uid(), p_user)
  );
$$;

revoke all on function public.are_friends(uuid) from public, anon;
grant execute on function public.are_friends(uuid) to authenticated;

create or replace function public.email_hint(p_email text)
returns text
language sql immutable
as $$
  select case
           when p_email is null or position('@' in p_email) = 0 then null
           else left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2)
         end;
$$;

/* ── people(): the panel ─────────────────────────────────────────────────── */

create or replace function public.people()
returns table (
  user_id      uuid,
  display_name text,
  avatar_url   text,
  email        text,
  email_hint   text,
  relation     text,
  in_my_group  boolean,
  read_count   integer,
  seen_at      timestamptz
)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  with me as (select auth.uid() as uid),
  rows as (
    select u.id as user_id,
           coalesce(p.display_name, '') as display_name,
           p.avatar_url,
           u.email::text as address,
           public.shares_pair_with(u.id) as in_group,
           case
             when public.shares_pair_with(u.id) then 'friend'
             when f.status = 'accepted' then 'friend'
             when f.status = 'pending' and f.requested_by = (select uid from me) then 'outgoing'
             when f.status = 'pending' then 'incoming'
             else 'none'
           end as relation,
           pr.seen_at
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.presence pr on pr.user_id = u.id
    left join public.friendships f
      on f.user_low  = least((select uid from me), u.id)
     and f.user_high = greatest((select uid from me), u.id)
    where (select uid from me) is not null
      and u.id <> (select uid from me)
  )
  select r.user_id,
         r.display_name,
         r.avatar_url,
         case when r.relation = 'friend' then r.address end,
         public.email_hint(r.address),
         r.relation,
         r.in_group,
         case when r.relation = 'friend' then (
           select count(*)::int
           from public.readings x
           where x.pair_id = public.pair_id_for(r.user_id)
             and x.read_by @> array[r.user_id::text]
         ) end,
         r.seen_at
  from rows r
  order by (r.relation = 'incoming') desc,
           (r.relation = 'friend') desc,
           lower(nullif(r.display_name, '')) nulls last,
           r.user_id
  limit 200;
$$;

revoke all on function public.people() from public, anon;
grant execute on function public.people() to authenticated;

/* ── add_friend(): ask, or accept ────────────────────────────────────────── */

create or replace function public.add_friend(p_user uuid)
returns text
language plpgsql volatile security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.friendships;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = 'PT401';
  end if;
  if p_user = auth.uid() then
    raise exception 'That is you.' using errcode = 'PT400';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'There is no account with that id.' using errcode = 'PT404';
  end if;

  insert into public.friendships as f (user_low, user_high, requested_by, status)
  values (least(auth.uid(), p_user), greatest(auth.uid(), p_user), auth.uid(), 'pending')
  on conflict (user_low, user_high) do update
    set status = case
                   when f.status = 'pending' and f.requested_by <> auth.uid() then 'accepted'
                   else f.status
                 end,
        responded_at = case
                         when f.status = 'pending' and f.requested_by <> auth.uid() then now()
                         else f.responded_at
                       end
  returning * into v_row;

  return case when v_row.status = 'accepted' then 'friends' else 'requested' end;
end;
$$;

revoke all on function public.add_friend(uuid) from public, anon;
grant execute on function public.add_friend(uuid) to authenticated;

/* ── remove_friend(): cancel, ignore, or part ────────────────────────────── */

create or replace function public.remove_friend(p_user uuid)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = 'PT401';
  end if;

  delete from public.friendships
   where user_low  = least(auth.uid(), p_user)
     and user_high = greatest(auth.uid(), p_user);

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;

/* ── touch_presence() ────────────────────────────────────────────────────── */

create or replace function public.touch_presence()
returns void
language sql volatile security definer
set search_path = public, pg_catalog
as $$
  insert into public.presence (user_id, seen_at)
  select auth.uid(), now()
  where auth.uid() is not null
  on conflict (user_id) do update
    set seen_at = now()
    -- Throttled here rather than in the client, so no amount of switching
    -- between apps can turn "I am about" into a write per second. Two minutes
    -- is well inside the five the panel calls "here now", so somebody who is
    -- actually around never flickers out of it.
    where public.presence.seen_at < now() - interval '2 minutes';
$$;

revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

/* ── backfill: people already reading together are already friends ───────── */

insert into public.friendships (user_low, user_high, requested_by, status, responded_at)
select least(a.user_id, b.user_id), greatest(a.user_id, b.user_id), a.user_id, 'accepted', now()
from public.pair_members a
join public.pair_members b on b.pair_id = a.pair_id and a.user_id < b.user_id
on conflict (user_low, user_high) do nothing;
