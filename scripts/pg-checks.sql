-- ═══════════════════════════════════════════════════════════════════════════
--  What the migrations are supposed to do, asserted against a real Postgres.
--
--  Run by scripts/check-sql.mjs, which applies 0001, 0002 and 0003 to a
--  throwaway cluster first. Every check raises on failure, so a non-zero exit
--  means the SQL is wrong.
--
--  The scenario is the one the app walks through: two people who signed up
--  before any of this existed, each reading alone, and then one of them
--  joining the other's group.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create or replace function public.ok(label text, condition boolean, detail text default '')
returns void
language plpgsql
as $$
begin
  if condition then
    raise notice '  ✓ %', label || case when detail = '' then '' else ' — ' || detail end;
  else
    raise exception '  ✗ %', label || case when detail = '' then '' else ' — ' || detail end;
  end if;
end;
$$;

/* ── accounts that predate all of this ── */
\echo ''
\echo 'Accounts that already existed'

select public.ok('the backfill gave every existing account a store',
  (select count(*) from public.pair_members) = 2,
  (select count(*)::text || ' memberships' from public.pair_members));
select public.ok('one each, not one between them',
  (select count(distinct pair_id) from public.pair_members) = 2);
select public.ok('and a profile row apiece, so the roster can name them',
  (select count(*) from public.profiles) = 2);

/* ── Fadhul, reading on his own ── */
\echo ''
\echo 'Signing in is enough'

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

create temp table mine as select * from public.ensure_pair();

select public.ok('ensure_pair hands back the store he already has',
  (select member_count from mine) = 1);
select public.ok('with an invite code ready to hand out', (select length(invite_code) from mine) = 8);
select public.ok('and calling it again does not make a second one',
  (select count(*) from public.pair_members where user_id = auth.uid()) = 1,
  (select count(*)::text || ' memberships' from public.pair_members where user_id = auth.uid()));

insert into public.readings (pair_id, entry_id, date_iso, notes_by, read_by)
select pair_id, 10, '2026-03-01', jsonb_build_object(auth.uid()::text, 'his note on ten'), array[auth.uid()::text] from mine;
insert into public.readings (pair_id, entry_id, date_iso, read_by)
select pair_id, 11, '2026-03-02', array[auth.uid()::text] from mine;

select public.ok('he can write readings with no group in sight',
  (select count(*) from public.readings) = 2);

/* ── Edith, who must see none of it ── */
\echo ''
\echo 'A private store is private'

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000b', false);
create temp table hers as select * from public.ensure_pair();

select public.ok('her store is not his', (select pair_id from hers) <> (select pair_id from mine));
select public.ok('she cannot see his readings', (select count(*) from public.readings) = 0);
select public.ok('nor his pair', (select count(*) from public.pairs) = 1);
select public.ok('and her roster is just her', (select count(*) from public.pair_readers()) = 1);

insert into public.readings (pair_id, entry_id, date_iso, notes_by, read_by)
select pair_id, 11, '2026-02-20', jsonb_build_object(auth.uid()::text, 'her note on eleven'), array[auth.uid()::text] from hers;
insert into public.readings (pair_id, entry_id, date_iso, read_by)
select pair_id, 12, '2026-03-03', array[auth.uid()::text] from hers;

/* ── joining ── */
\echo ''
\echo 'Joining brings your history with you'

select public.ok('the code lets her in',
  public.join_pair((select invite_code from mine)) = (select pair_id from mine));
select public.ok('she is in exactly one pair afterwards',
  (select count(*) from public.pair_members where user_id = auth.uid()) = 1,
  (select count(*)::text from public.pair_members where user_id = auth.uid()));
select public.ok('and it is his', (select pair_id from public.pair_members where user_id = auth.uid()) = (select pair_id from mine));
select public.ok('her own store is gone rather than left orphaned',
  not exists (select 1 from public.pairs where id = (select pair_id from hers)));

select public.ok('nothing she read alone was lost',
  (select count(*) from public.readings where pair_id = (select pair_id from mine)) = 3,
  (select string_agg(entry_id::text, ',' order by entry_id) from public.readings));
select public.ok('an entry only she had came across',
  exists (select 1 from public.readings where entry_id = 12 and read_by @> array['00000000-0000-4000-8000-00000000000b']));
select public.ok('an entry both had kept both ticks',
  (select array_length(read_by, 1) from public.readings where entry_id = 11) = 2,
  (select array_to_string(read_by, ' ') from public.readings where entry_id = 11));
select public.ok('and her note survived the fold',
  (select notes_by ->> '00000000-0000-4000-8000-00000000000b' from public.readings where entry_id = 11) = 'her note on eleven',
  (select notes_by::text from public.readings where entry_id = 11));
select public.ok('the earlier of the two dates is the one that survives',
  (select date_iso from public.readings where entry_id = 11) = '2026-02-20',
  (select date_iso::text from public.readings where entry_id = 11));

/* ── the group agrees with itself ── */
\echo ''
\echo 'One answer to "which pair is mine"'

select public.ok('she sees the group as her pair', (select pair_id from public.my_pair()) = (select pair_id from mine));
select public.ok('with two readers in it', (select member_count from public.my_pair()) = 2);
select public.ok('and the roster names both', (select count(*) from public.pair_readers()) = 2);
select public.ok('with the addresses they signed up with',
  (select count(*) from public.pair_readers() where email like '%@example.com') = 2);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
select public.ok('he sees the same pair', (select pair_id from public.my_pair()) = (select pair_id from mine));
select public.ok('ensure_pair does not invent another for him',
  (select pair_id from public.ensure_pair()) = (select pair_id from mine));
select public.ok('his roster is the same two people', (select count(*) from public.pair_readers()) = 2);
select public.ok('and his history now includes what she brought', (select count(*) from public.readings) = 3);
select public.ok('"start a shared history" hands back the one he is in',
  (select pair_id from public.create_pair()) = (select pair_id from mine));

/* ── a brand new account, after all of this ── */
\echo ''
\echo 'A brand new account'

reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000c', 'new@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false);

select public.ok('gets a store the first time it asks', (select count(*) from public.ensure_pair()) = 1);
select public.ok('of its own', (select pair_id from public.ensure_pair()) <> (select pair_id from mine));
select public.ok('and only one, however many times it asks',
  (select count(*) from public.pair_members where user_id = auth.uid()) = 1);
select public.ok('with nothing of anybody else''s in it', (select count(*) from public.readings) = 0);

/* ── what is not allowed ── */
\echo ''
\echo 'What is refused'

do $$
declare
  failed boolean := false;
begin
  begin
    perform public.join_pair('ZZZZZZZZ');
  exception when others then
    failed := true;
    perform public.ok('a code nobody has is refused', sqlstate = 'PT404', sqlstate);
  end;
  perform public.ok('and refused rather than quietly ignored', failed);
end
$$;

do $$
begin
  begin
    perform public.absorb_pair(gen_random_uuid(), gen_random_uuid());
    raise exception 'absorb_pair should not be callable by a client';
  exception when insufficient_privilege then
    perform public.ok('a client cannot move readings between pairs itself', true);
  end;
end
$$;

/* ═══════════════════════════════════════════════════════════════════════════
   0004 — people and friends
   ═══════════════════════════════════════════════════════════════════════════ */

\echo ''
\echo 'The people panel'

-- Fadhul (…a) and Edith (…b) share a pair from the earlier checks; the new
-- account (…c) is on its own.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

select public.ok('the panel lists everybody else and never yourself',
  (select count(*) from public.people()) = 2
  and not exists (select 1 from public.people() where user_id = auth.uid()),
  (select count(*)::text || ' people' from public.people()));

-- Fadhul and Edith share a pair from the checks above, which happened after
-- 0004 ran — so there is no friendship row for them, and the panel must still
-- not call somebody a stranger while Settings → Readers names them.
select public.ok('somebody you already read with is not listed as a stranger',
  (select relation from public.people() where user_id = '00000000-0000-4000-8000-00000000000b') = 'friend',
  (select relation from public.people() where user_id = '00000000-0000-4000-8000-00000000000b'));
select public.ok('and is marked as a group-mate, so Remove is not offered',
  (select in_my_group from public.people() where user_id = '00000000-0000-4000-8000-00000000000b'));
select public.ok('with no friendship row behind it',
  not exists (select 1 from public.friendships
              where user_low = least('00000000-0000-4000-8000-00000000000a'::uuid, '00000000-0000-4000-8000-00000000000b'::uuid)
                and user_high = greatest('00000000-0000-4000-8000-00000000000a'::uuid, '00000000-0000-4000-8000-00000000000b'::uuid)));
select public.ok('somebody you have never met is a stranger',
  (select relation from public.people() where user_id = '00000000-0000-4000-8000-00000000000c') = 'none');
select public.ok('and is not a group-mate',
  not (select in_my_group from public.people() where user_id = '00000000-0000-4000-8000-00000000000c'));

-- The backfill itself: run it again now that two accounts share a pair, which
-- is the state a project that had been using invite codes is in when 0004
-- arrives. It should turn co-readers into friends and nobody else.
reset role;
insert into public.friendships (user_low, user_high, requested_by, status, responded_at)
select least(a.user_id, b.user_id), greatest(a.user_id, b.user_id), a.user_id, 'accepted', now()
from public.pair_members a
join public.pair_members b on b.pair_id = a.pair_id and a.user_id < b.user_id
on conflict (user_low, user_high) do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

select public.ok('the backfill makes existing co-readers friends',
  (select count(*) from public.friendships where status = 'accepted') = 1,
  (select count(*)::text from public.friendships));
select public.ok('and leaves everybody else alone',
  (select relation from public.people() where user_id = '00000000-0000-4000-8000-00000000000c') = 'none');

\echo ''
\echo 'What a stranger may know about you'

select public.ok('a friend''s address is shown',
  (select email from public.people() where user_id = '00000000-0000-4000-8000-00000000000b') = 'edith@example.com');
select public.ok('a stranger''s is not',
  (select email from public.people() where user_id = '00000000-0000-4000-8000-00000000000c') is null,
  coalesce((select email from public.people() where user_id = '00000000-0000-4000-8000-00000000000c'), 'null'));
select public.ok('only a hint of it, enough to recognise and not to collect',
  (select email_hint from public.people() where user_id = '00000000-0000-4000-8000-00000000000c') = 'n•••@example.com',
  (select email_hint from public.people() where user_id = '00000000-0000-4000-8000-00000000000c'));
select public.ok('and there is no way to search for an address at all',
  (select count(*) from pg_proc where proname = 'people' and pronargs > 0) = 0);

\echo ''
\echo 'Asking, and being asked'

select public.ok('adding a stranger asks rather than assumes',
  public.add_friend('00000000-0000-4000-8000-00000000000c') = 'requested');
select public.ok('asking twice is nothing, not an error',
  public.add_friend('00000000-0000-4000-8000-00000000000c') = 'requested');
select public.ok('there is one row for the couple, never two',
  (select count(*) from public.friendships
   where user_low = least('00000000-0000-4000-8000-00000000000a'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid)
     and user_high = greatest('00000000-0000-4000-8000-00000000000a'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid)) = 1);
select public.ok('and it reads as sent while it waits',
  (select relation from public.people() where user_id = '00000000-0000-4000-8000-00000000000c') = 'outgoing');
select public.ok('a pending request leaks no address',
  (select email from public.people() where user_id = '00000000-0000-4000-8000-00000000000c') is null);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false);
select public.ok('the other side sees it as waiting on them',
  (select relation from public.people() where user_id = '00000000-0000-4000-8000-00000000000a') = 'incoming');
select public.ok('and it is put at the top of the list',
  (select user_id from public.people() limit 1) = '00000000-0000-4000-8000-00000000000a');

select public.ok('tapping add on somebody who asked you is an acceptance',
  public.add_friend('00000000-0000-4000-8000-00000000000a') = 'friends');
select public.ok('both sides now read as friends',
  (select relation from public.people() where user_id = '00000000-0000-4000-8000-00000000000a') = 'friend');
select public.ok('and the address arrives with the friendship',
  (select email from public.people() where user_id = '00000000-0000-4000-8000-00000000000a') = 'fadhul@example.com');

\echo ''
\echo 'A friendship is not a reading group'

select public.ok('befriending gave you no readings of theirs',
  (select count(*) from public.readings) = 0,
  (select count(*)::text || ' readings visible' from public.readings));
-- `mine` is Fadhul's pair, captured as a temp table earlier, so this compares
-- against a real id rather than against the null that RLS would hand back.
select public.ok('nor put you in their pair', not public.is_pair_member((select pair_id from mine)));
select public.ok('you are still in your own',
  (select pair_id from public.my_pair()) <> (select pair_id from mine),
  (select pair_id::text from public.my_pair()));
select public.ok('their roster is still their roster',
  (select count(*) from public.pair_readers()) = 1);
select public.ok('but you can see how far along they are',
  (select read_count from public.people() where user_id = '00000000-0000-4000-8000-00000000000a') = 2,
  (select read_count::text from public.people() where user_id = '00000000-0000-4000-8000-00000000000a'));

\echo ''
\echo 'Parting'

select public.ok('removing a friend works', public.remove_friend('00000000-0000-4000-8000-00000000000a'));
select public.ok('and they go back to being a stranger',
  (select relation from public.people() where user_id = '00000000-0000-4000-8000-00000000000a') = 'none');
select public.ok('taking their address back with them',
  (select email from public.people() where user_id = '00000000-0000-4000-8000-00000000000a') is null);
select public.ok('removing somebody twice is harmless',
  public.remove_friend('00000000-0000-4000-8000-00000000000a') = false);
select public.ok('and nothing either of them read was touched',
  (select count(*) from public.readings) = 0);

reset role;
select public.ok('the readings survived every bit of that',
  (select count(*) from public.readings) = 3,
  (select count(*)::text from public.readings));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false);

\echo ''
\echo 'Presence'

select public.ok('nobody has been seen before they open the app',
  (select seen_at from public.people() where user_id = '00000000-0000-4000-8000-00000000000a') is null);
-- Bare, so a failure aborts the run: ON_ERROR_STOP is the assertion here.
select public.touch_presence();
-- Read back as superuser: a client is not allowed to read this table at all,
-- which is the point of the check two lines further down.
reset role;
select public.ok('opening the app stamps that you were here',
  (select seen_at from public.presence
   where user_id = '00000000-0000-4000-8000-00000000000c') > now() - interval '1 minute');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
select public.ok('and the others can then see they are about',
  (select seen_at from public.people() where user_id = '00000000-0000-4000-8000-00000000000c') > now() - interval '1 minute');
select public.ok('the presence table itself is not readable by a client',
  not has_table_privilege('authenticated', 'public.presence', 'SELECT'));

\echo ''
\echo 'What is refused'

do $$
begin
  begin
    perform public.add_friend(auth.uid());
    raise exception 'adding yourself should be refused';
  exception when others then
    perform public.ok('you cannot befriend yourself', sqlstate = 'PT400', sqlstate);
  end;
end
$$;

do $$
begin
  begin
    perform public.add_friend('00000000-0000-4000-8000-0000000000ff');
    raise exception 'adding a non-account should be refused';
  exception when others then
    perform public.ok('you cannot befriend an account that does not exist', sqlstate = 'PT404', sqlstate);
  end;
end
$$;

do $$
begin
  begin
    insert into public.friendships (user_low, user_high, requested_by, status)
    values (least(auth.uid(), '00000000-0000-4000-8000-00000000000c'::uuid),
            greatest(auth.uid(), '00000000-0000-4000-8000-00000000000c'::uuid),
            auth.uid(), 'accepted');
    raise exception 'a client should not be able to forge a friendship';
  exception when insufficient_privilege then
    perform public.ok('a client cannot write itself a friendship directly', true);
  end;
end
$$;

reset role;
