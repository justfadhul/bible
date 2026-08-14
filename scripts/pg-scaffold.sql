-- ═══════════════════════════════════════════════════════════════════════════
--  Just enough Supabase to run the migrations against a plain Postgres.
--
--  The migrations lean on four things a hosted project provides and a bare
--  cluster does not: the anon/authenticated roles, auth.users, auth.uid(), and
--  the storage schema. This stands those up so `npm run check-sql` can apply
--  0001–0003 for real and then exercise them — which matters more than usual
--  here, because nothing in this build environment can reach the actual
--  project, so the alternative to this is shipping SQL nobody has ever run.
--
--  It is a test fixture. Nothing here is deployed anywhere.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email varchar(255) unique
);

-- PostgREST sets the claims as a GUC per request; this is the same shape.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text not null,
  owner     uuid
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

grant usage on schema storage to anon, authenticated, service_role;
