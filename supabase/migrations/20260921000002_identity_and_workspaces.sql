-- =============================================================================
-- Module 1 / 0002 — users, workspaces, members, invites, setup profile
-- Sections 3, 5, 6.3, 10.
-- =============================================================================

-- --- users ------------------------------------------------------------------
-- Profile row mirroring auth.users. Auth itself (password, email confirmation)
-- stays in auth.users; this holds the product state the router gate reads.
create table public.users (
  id                        uuid primary key references auth.users(id) on delete cascade,
  email                     text not null,
  full_name                 text,
  avatar_url                text,

  -- Country picked at signup. One of the three region inputs (Section 7A.2);
  -- never the deciding one.
  signup_country            text,

  -- Section 3: exactly one active module, swappable from Settings.
  active_module             public.module_type,
  active_workspace_id       uuid,

  -- Section 5: saved state machine. The router resumes here.
  onboarding_step           public.onboarding_step not null default 'verify_email',
  onboarding_completed_at   timestamptz,

  -- Section 8: WhatsApp control, Phase 3.
  whatsapp_number           text,
  whatsapp_number_verified  boolean not null default false,

  is_platform_admin         boolean not null default false,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on column public.users.active_module is
  'Section 3. The self module is assigned by a platform admin and never offered in public signup.';
comment on column public.users.onboarding_step is
  'Section 5. Persisted so the router can resume the user exactly where they left.';

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

-- Mirror every new auth user into public.users.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- --- workspaces --------------------------------------------------------------
create table public.workspaces (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,

  -- Section 3: Personal = 1 workspace, Business = 1 brand,
  -- Self (MOTiF) = many, one per client brand.
  type                       public.module_type not null,
  owner_id                   uuid not null references public.users(id) on delete restrict,

  -- Section 6.2: posts are stored in UTC and displayed in this zone.
  timezone                   text not null default 'Asia/Dhaka',

  -- Section 7A.2 rule 4: null until the first payment, then frozen.
  -- Region belongs to the workspace, not the user, so a team spread across
  -- countries still bills in one currency (Section 7A.3).
  billing_region             public.billing_region,
  billing_region_locked_at   timestamptz,

  -- Section 13 Q4: Self (MOTiF) is internal and exempt from the paywall.
  is_billing_exempt          boolean not null default false,

  -- Section 6.3: when approvals are on, an editor's post lands in
  -- pending_approval instead of scheduled.
  approvals_enabled          boolean not null default false,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint workspace_region_lock_is_coherent check (
    billing_region_locked_at is null or billing_region is not null
  )
);

comment on column public.workspaces.billing_region is
  'Section 7A.2. Locked after the first successful payment; changing it afterwards is support-only, at renewal, to stop monthly price hopping.';

create index workspaces_owner_idx on public.workspaces(owner_id);

create trigger workspaces_touch_updated_at
  before update on public.workspaces
  for each row execute function public.touch_updated_at();

-- Once locked, the region is immutable. Support changing a region is a
-- cancel-and-reissue of the subscription at renewal, not an UPDATE here, so
-- this trigger blocks the service role too.
create or replace function public.guard_billing_region_lock()
returns trigger
language plpgsql
as $fn$
begin
  if old.billing_region_locked_at is not null
     and new.billing_region is distinct from old.billing_region then
    raise exception 'billing_region is locked for workspace % (locked at %)',
      old.id, old.billing_region_locked_at
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

create trigger workspaces_guard_region_lock
  before update on public.workspaces
  for each row execute function public.guard_billing_region_lock();

alter table public.users
  add constraint users_active_workspace_fk
  foreign key (active_workspace_id) references public.workspaces(id) on delete set null;

-- --- workspace_members -------------------------------------------------------
create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          public.workspace_role not null default 'viewer',
  invited_by    uuid references public.users(id) on delete set null,
  joined_at     timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members(user_id);

-- Section 6.3: the last owner cannot leave or be demoted.
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  owners_left int;
  -- NEW is unassigned in a DELETE trigger, so the return value is decided
  -- once, here, and never read from NEW on the delete path.
  result public.workspace_members;
begin
  if tg_op = 'DELETE' then
    result := old;
  else
    result := new;
  end if;

  if old.role <> 'owner' then
    return result;
  end if;

  -- An UPDATE that leaves the row an owner changes nothing here.
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  select count(*) into owners_left
  from public.workspace_members
  where workspace_id = old.workspace_id
    and role = 'owner'
    and user_id <> old.user_id;

  if owners_left = 0 then
    raise exception 'workspace % would be left with no owner; transfer ownership first',
      old.workspace_id
      using errcode = 'check_violation';
  end if;

  return result;
end;
$fn$;

create trigger workspace_members_guard_last_owner
  before update or delete on public.workspace_members
  for each row execute function public.guard_last_owner();

-- --- RLS helpers -------------------------------------------------------------
-- SECURITY DEFINER so the membership lookup is not itself filtered by the
-- policies that call it, which would recurse forever.

create or replace function public.member_role(ws uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select role
  from public.workspace_members
  where workspace_id = ws and user_id = auth.uid()
$fn$;

create or replace function public.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  )
$fn$;

-- Enum values are declared viewer < editor < admin < owner, so the rank check
-- is just `>=`.
create or replace function public.has_role(ws uuid, minimum public.workspace_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(public.member_role(ws) >= minimum, false)
$fn$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select is_platform_admin from public.users where id = auth.uid()),
    false
  )
$fn$;

-- --- profiles_setup ----------------------------------------------------------
-- Section 10: "feeds AI". One per workspace, written in onboarding Step 1 and
-- read by the AI Planner in Phase 2.
create table public.profiles_setup (
  workspace_id    uuid primary key references public.workspaces(id) on delete cascade,
  brand_name      text,
  industry        text,
  website_url     text,
  description     text,
  target_audience text,
  brand_voice     text,
  goals           text[],
  keywords        text[],
  extra           jsonb not null default '{}'::jsonb,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger profiles_setup_touch_updated_at
  before update on public.profiles_setup
  for each row execute function public.touch_updated_at();

-- --- invites -----------------------------------------------------------------
-- Section 6.3: single-use, 7-day expiry, bound to one email address.
create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  email         text not null,
  role          public.workspace_role not null default 'viewer',

  -- Only the hash is stored. The raw token lives in the emailed link and
  -- nowhere else, so a database leak does not hand over working invites.
  token_hash    text not null unique,

  invited_by    uuid references public.users(id) on delete set null,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references public.users(id) on delete set null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),

  -- Ownership is transferred, never invited.
  constraint invites_role_not_owner check (role <> 'owner')
);

create index invites_workspace_idx on public.invites(workspace_id);
create index invites_email_idx on public.invites(lower(email));

-- One live invite per email per workspace.
create unique index invites_one_pending_per_email
  on public.invites (workspace_id, lower(email))
  where accepted_at is null and revoked_at is null;
