-- =============================================================================
-- Module 1 / 0003 — social_accounts, account_transfer_requests
-- Sections 6.1, 10. Decision #7: the same social account cannot live in two
-- workspaces.
-- =============================================================================

create table public.social_accounts (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces(id) on delete cascade,
  platform                  public.platform not null,

  -- The platform's own id for the page / profile / channel. This, paired with
  -- the platform, is the identity we deduplicate on.
  external_account_id       text not null,
  external_username         text,
  display_name              text,
  avatar_url                text,

  -- 'page', 'business', 'profile', 'channel' -- used by the "wrong account
  -- type" branch of onboarding Step 2 to explain the fix.
  account_type              text,

  -- Instagram business accounts hang off a Facebook page; this keeps that link.
  parent_external_id        text,

  -- AES-256-GCM, encrypted in the application before it reaches Postgres.
  -- The key lives in the environment (TOKEN_ENCRYPTION_KEY), so a database
  -- dump on its own yields nothing usable.
  access_token_encrypted    text,
  refresh_token_encrypted   text,
  token_expires_at          timestamptz,
  scopes                    text[],

  status                    public.connection_status not null default 'active',
  -- Why the connection went to needs_reconnect: 'token_refresh_failed',
  -- 'revoked_on_platform', 'missing_permissions'.
  status_reason             text,

  -- Section 7.1: the subscription price is per connected account. True once a
  -- seat is paid for this account; the publish gate reads it.
  paid_seat                 boolean not null default false,
  -- Section 7.2: a removed account keeps its seat until the cycle ends.
  seat_paid_until           timestamptz,

  connected_by              uuid references public.users(id) on delete set null,
  connected_at              timestamptz not null default now(),
  last_synced_at            timestamptz,
  disconnected_at           timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.social_accounts is
  'Section 6.1. One row per connected page / profile / channel.';

-- Decision #7 and Section 6.1: a live account belongs to exactly one workspace.
--
-- Partial, not total, on purpose. Rows in 'disconnected' or 'transferred' are
-- kept for history and for the audit trail, but they release the claim -- so a
-- user who disconnects can reconnect, and a transfer can hand the account to
-- another workspace without deleting where it came from.
--
-- This is also what makes the race in Section 6.1 ("two users connect the same
-- account at the same second") fail cleanly for the second writer rather than
-- silently duplicating.
create unique index social_accounts_one_live_claim
  on public.social_accounts (platform, external_account_id)
  where status in ('active', 'needs_reconnect');

create index social_accounts_workspace_idx on public.social_accounts(workspace_id);
create index social_accounts_status_idx on public.social_accounts(status);
-- Drives the token-refresh cron (Section 9).
create index social_accounts_token_expiry_idx
  on public.social_accounts (token_expires_at)
  where status = 'active';

create trigger social_accounts_touch_updated_at
  before update on public.social_accounts
  for each row execute function public.touch_updated_at();

-- Stamp disconnected_at whenever a connection leaves the live states.
create or replace function public.stamp_disconnected_at()
returns trigger
language plpgsql
as $fn$
begin
  if new.status in ('disconnected', 'transferred')
     and old.status not in ('disconnected', 'transferred') then
    new.disconnected_at = coalesce(new.disconnected_at, now());
  elsif new.status in ('active', 'needs_reconnect') then
    new.disconnected_at = null;
  end if;
  return new;
end;
$fn$;

create trigger social_accounts_stamp_disconnected
  before update on public.social_accounts
  for each row execute function public.stamp_disconnected_at();

-- --- account_transfer_requests ----------------------------------------------
-- Section 6.1: the real owner is locked out because an old agency still holds
-- the page, or a client leaves MOTiF and signs up on their own. Support moves
-- the account after a platform-side admin check.
--
-- Keyed by (platform, external_account_id) rather than by social_accounts.id,
-- because the requester legitimately cannot see the row that currently holds
-- the account -- they are not a member of that workspace.
create table public.account_transfer_requests (
  id                   uuid primary key default gen_random_uuid(),
  platform             public.platform not null,
  external_account_id  text not null,

  -- Never exposed to the requester. Section 6.1 is explicit: the blocked
  -- message must not reveal which workspace holds the account or who owns it.
  from_workspace_id    uuid references public.workspaces(id) on delete set null,
  to_workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  requested_by         uuid not null references public.users(id) on delete cascade,
  -- What the requester submitted; the decision still rests on a platform-side
  -- admin check performed by support.
  evidence             text,
  evidence_urls        text[],

  status               public.transfer_status not null default 'pending',
  resolved_by          uuid references public.users(id) on delete set null,
  resolved_at          timestamptz,
  resolution_note      text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index account_transfer_requests_target_idx
  on public.account_transfer_requests (platform, external_account_id);
create index account_transfer_requests_to_ws_idx
  on public.account_transfer_requests (to_workspace_id);

-- One open request per account per claiming workspace.
create unique index account_transfer_requests_one_open
  on public.account_transfer_requests (platform, external_account_id, to_workspace_id)
  where status = 'pending';

create trigger account_transfer_requests_touch_updated_at
  before update on public.account_transfer_requests
  for each row execute function public.touch_updated_at();
