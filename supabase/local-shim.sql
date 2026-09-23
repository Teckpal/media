-- Minimal Supabase shim: the parts of a Supabase project the migrations touch.
-- Not a substitute for Supabase. Enough to execute the SQL and prove it parses,
-- plans and runs on a real Postgres 17.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

-- Supabase grants these on a real project, so the shim has to as well or the
-- harness cannot check anything as a non-superuser. `public` was missing here
-- and nothing noticed, because every earlier rule ran as the owner — where RLS
-- does not apply at all. A policy is only real if somebody subject to it is
-- the one asking.
grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth       to anon, authenticated, service_role;
grant usage on schema storage    to anon, authenticated, service_role;

-- And the same blanket table grants Supabase applies, so that RLS — not a
-- missing GRANT — is what decides who sees what. These are default privileges
-- rather than a one-off grant because every table is created by a later
-- migration; a plain `grant on all tables` here would cover nothing.
--
-- Broad on purpose, exactly as on a real project: the policies are the
-- security boundary, and a migration that revokes something afterwards (as
-- 0018 and 0019 do for their functions) still wins, because it runs later.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

alter database postgres set search_path to public, extensions;

-- --- auth ---------------------------------------------------------------
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Supabase reads the verified JWT that PostgREST puts on the connection.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

-- --- storage ------------------------------------------------------------
create table storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table storage.objects (
  id             uuid primary key default gen_random_uuid(),
  bucket_id      text references storage.buckets(id),
  name           text,
  owner          uuid,
  metadata       jsonb,
  path_tokens    text[],
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated, service_role;
