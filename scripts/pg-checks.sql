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

reset role;
