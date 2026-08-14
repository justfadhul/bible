-- Two accounts that exist *before* 0003 runs, so the backfill at the end of it
-- has something to find. These are the people the app already has: an account
-- created back when signing in gave you nowhere to write.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'fadhul@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'edith@example.com')
on conflict do nothing;
