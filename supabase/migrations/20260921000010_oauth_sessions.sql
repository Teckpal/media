-- =============================================================================
-- Module 4 / 0010 — oauth_sessions
--
-- Between the OAuth callback and the user choosing which pages to connect,
-- there is a short-lived user access token that belongs to neither.
--
-- It cannot go in a cookie: Meta's long-lived user tokens plus the page list
-- overrun the 4KB budget, and a token in a cookie is a token in a browser.
-- It cannot go straight into social_accounts either, because Section 7.1 bills
-- per connected account -- connecting every page a user happens to administer
-- would quietly charge them for pages they never asked for.
--
-- So it waits here, encrypted, for a few minutes, until the user picks.
-- =============================================================================

create table public.oauth_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  platform              public.platform not null,

  -- AES-256-GCM, same vault as social_accounts.
  access_token_encrypted  text not null,
  refresh_token_encrypted text,
  token_expires_at      timestamptz,

  -- What the platform actually granted, which is not always what was asked
  -- for. Section 6.1's "missing permissions" branch is decided from this.
  granted_scopes        text[] not null default '{}',

  -- Minutes, not hours. The window is only as long as it takes to tick some
  -- boxes, and a stale session is a live token sitting in a table.
  expires_at            timestamptz not null,
  consumed_at           timestamptz,

  created_at            timestamptz not null default now()
);

create index oauth_sessions_user_idx on public.oauth_sessions(user_id);
create index oauth_sessions_sweep_idx on public.oauth_sessions(expires_at);

alter table public.oauth_sessions enable row level security;

-- No policy of any kind. The whole lifecycle -- create at callback, read at
-- selection, consume on submit -- runs with the service role, so this row is
-- never reachable from a browser even by its owner.

-- Cron sweep. Belt and braces on top of the expiry check every reader does.
create or replace function public.purge_expired_oauth_sessions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  removed integer;
begin
  delete from public.oauth_sessions
  where expires_at < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

comment on function public.purge_expired_oauth_sessions is
  'Deletes spent OAuth handoff rows. Run from the cron endpoint; an expired row still holds a live platform token.';
