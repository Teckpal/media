-- Minimal Supabase shim: the parts of a Supabase project the migrations touch.
-- Not a substitute for Supabase. Enough to execute the SQL and prove it parses,
-- plans and runs on a real Postgres 17.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth       to anon, authenticated, service_role;
grant usage on schema storage    to anon, authenticated, service_role;

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
