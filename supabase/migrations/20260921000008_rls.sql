-- =============================================================================
-- Module 1 / 0008 — row level security
--
-- Section 4: "UI hides buttons, but the server enforces. A crafted API call
-- cannot bypass either gate." These policies are the floor under that promise.
-- Every table is deny-by-default; a table with no policy for an action refuses
-- that action to every client, which is how the server-only tables stay
-- server-only.
--
-- The role ladder from Section 6.3 maps to the helpers in 0002:
--   viewer  read
--   editor  create and edit posts
--   admin   everything except billing and deletion
--   owner   everything
-- =============================================================================

alter table public.users                     enable row level security;
alter table public.workspaces                enable row level security;
alter table public.workspace_members         enable row level security;
alter table public.profiles_setup            enable row level security;
alter table public.invites                   enable row level security;
alter table public.social_accounts           enable row level security;
alter table public.account_transfer_requests enable row level security;
alter table public.post_media                enable row level security;
alter table public.posts                     enable row level security;
alter table public.post_targets              enable row level security;
alter table public.approvals                 enable row level security;
alter table public.plans                     enable row level security;
alter table public.subscriptions             enable row level security;
alter table public.invoices                  enable row level security;
alter table public.invoice_lines             enable row level security;
alter table public.payments                  enable row level security;
alter table public.gateway_events            enable row level security;
alter table public.billing_credits           enable row level security;
alter table public.ai_credit_ledger          enable row level security;
alter table public.ai_plans                  enable row level security;
alter table public.notifications             enable row level security;
alter table public.notification_deliveries   enable row level security;
alter table public.whatsapp_links            enable row level security;
alter table public.audit_log                 enable row level security;

-- Resolves a post to its workspace without tripping the posts policies, which
-- would otherwise recurse through the policies that call this.
create or replace function public.post_workspace(p uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select workspace_id from public.posts where id = p
$fn$;

-- Does this user share any workspace with that one? Lets teammates see each
-- other's name and avatar without exposing the whole user table.
create or replace function public.shares_workspace_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs using (workspace_id)
    where mine.user_id = auth.uid() and theirs.user_id = other
  )
$fn$;

-- --- users -------------------------------------------------------------------
create policy users_select_self_or_teammate on public.users
  for select to authenticated
  using (id = auth.uid() or public.shares_workspace_with(id));

create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- A user may edit their own row, but not hand themselves the platform admin
-- flag that unlocks the Self (MOTiF) module (Section 3).
create or replace function public.guard_self_elevation()
returns trigger
language plpgsql
as $fn$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and auth.uid() = old.id then
    raise exception 'is_platform_admin cannot be changed by the user it belongs to'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$fn$;

create trigger users_guard_self_elevation
  before update on public.users
  for each row execute function public.guard_self_elevation();

-- --- workspaces --------------------------------------------------------------
create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (public.is_member(id) or public.is_platform_admin());

create policy workspaces_insert_as_owner on public.workspaces
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using (public.has_role(id, 'admin'))
  with check (public.has_role(id, 'admin'));

-- Section 6.3: deletion is the owner's alone.
create policy workspaces_delete_owner on public.workspaces
  for delete to authenticated
  using (public.has_role(id, 'owner'));

-- --- workspace_members -------------------------------------------------------
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (public.is_member(workspace_id));

create policy workspace_members_write_admin on public.workspace_members
  for all to authenticated
  using (public.has_role(workspace_id, 'admin'))
  with check (public.has_role(workspace_id, 'admin'));

-- --- profiles_setup ----------------------------------------------------------
create policy profiles_setup_select on public.profiles_setup
  for select to authenticated
  using (public.is_member(workspace_id));

create policy profiles_setup_write_admin on public.profiles_setup
  for all to authenticated
  using (public.has_role(workspace_id, 'admin'))
  with check (public.has_role(workspace_id, 'admin'));

-- --- invites -----------------------------------------------------------------
-- Accepting an invite happens server-side: the invitee is not a member yet, so
-- no policy here could see them. The server validates the token hash with the
-- service role and inserts the membership itself.
create policy invites_manage_admin on public.invites
  for all to authenticated
  using (public.has_role(workspace_id, 'admin'))
  with check (public.has_role(workspace_id, 'admin'));

-- --- social_accounts ---------------------------------------------------------
create policy social_accounts_select on public.social_accounts
  for select to authenticated
  using (public.is_member(workspace_id));

create policy social_accounts_write_admin on public.social_accounts
  for all to authenticated
  using (public.has_role(workspace_id, 'admin'))
  with check (public.has_role(workspace_id, 'admin'));

-- RLS filters rows, not columns. Tokens are for the publish worker, which runs
-- with the service role, so no browser client may read them at all.
--
-- A table-level GRANT SELECT covers every column and cannot be narrowed by
-- revoking one of them, so the grant is dropped and re-issued as an explicit
-- column list. A column added later is therefore invisible to clients until it
-- is named here -- which is the safer direction for a table holding tokens.
revoke select on public.social_accounts from authenticated, anon;
grant select (
  id, workspace_id, platform, external_account_id, external_username,
  display_name, avatar_url, account_type, parent_external_id,
  token_expires_at, scopes, status, status_reason,
  paid_seat, seat_paid_until,
  connected_by, connected_at, last_synced_at, disconnected_at,
  created_at, updated_at
) on public.social_accounts to authenticated;

-- --- account_transfer_requests -----------------------------------------------
-- Only the claiming workspace sees its own request. Section 6.1 is explicit
-- that the holder of the account must never be revealed to the requester.
create policy transfers_select_claimant on public.account_transfer_requests
  for select to authenticated
  using (public.is_member(to_workspace_id));

create policy transfers_insert_claimant on public.account_transfer_requests
  for insert to authenticated
  with check (
    public.has_role(to_workspace_id, 'admin') and requested_by = auth.uid()
  );

-- Support resolves these with the service role; nobody edits their own request.
--
-- The policy above already limits rows to the claiming workspace, but the row
-- still names who currently holds the account. Section 6.1 says that must never
-- reach the requester, so from_workspace_id is left out of the column grant.
revoke select on public.account_transfer_requests from authenticated, anon;
grant select (
  id, platform, external_account_id, to_workspace_id, requested_by,
  evidence, evidence_urls, status, resolved_by, resolved_at, resolution_note,
  created_at, updated_at
) on public.account_transfer_requests to authenticated;

-- --- post_media --------------------------------------------------------------
create policy post_media_select on public.post_media
  for select to authenticated
  using (public.is_member(workspace_id));

create policy post_media_write_editor on public.post_media
  for all to authenticated
  using (public.has_role(workspace_id, 'editor'))
  with check (public.has_role(workspace_id, 'editor'));

-- --- posts -------------------------------------------------------------------
create policy posts_select on public.posts
  for select to authenticated
  using (public.is_member(workspace_id));

create policy posts_insert_editor on public.posts
  for insert to authenticated
  with check (public.has_role(workspace_id, 'editor'));

create policy posts_update_editor on public.posts
  for update to authenticated
  using (public.has_role(workspace_id, 'editor'))
  with check (public.has_role(workspace_id, 'editor'));

create policy posts_delete_editor on public.posts
  for delete to authenticated
  using (public.has_role(workspace_id, 'editor'));

-- --- post_targets ------------------------------------------------------------
create policy post_targets_select on public.post_targets
  for select to authenticated
  using (public.is_member(public.post_workspace(post_id)));

create policy post_targets_write_editor on public.post_targets
  for all to authenticated
  using (public.has_role(public.post_workspace(post_id), 'editor'))
  with check (public.has_role(public.post_workspace(post_id), 'editor'));

-- --- approvals ---------------------------------------------------------------
create policy approvals_select on public.approvals
  for select to authenticated
  using (public.is_member(workspace_id));

-- An editor may ask for approval.
create policy approvals_insert_editor on public.approvals
  for insert to authenticated
  with check (public.has_role(workspace_id, 'editor'));

-- Only an admin or owner may decide one (Section 6.3).
create policy approvals_update_admin on public.approvals
  for update to authenticated
  using (public.has_role(workspace_id, 'admin'))
  with check (public.has_role(workspace_id, 'admin'));

-- --- plans -------------------------------------------------------------------
-- Public on purpose: the BD and Global pricing pages are read by visitors who
-- have not signed up. Only active plans, and only ever read.
create policy plans_select_public on public.plans
  for select to anon, authenticated
  using (is_active);

-- --- billing: owner reads, server writes -------------------------------------
-- Section 6.3: "Admin: everything except billing and deletion." So billing is
-- the owner's alone, and every write goes through the service role after the
-- gateway has been verified server-side.
create policy subscriptions_select_owner on public.subscriptions
  for select to authenticated
  using (public.has_role(workspace_id, 'owner'));

create policy invoices_select_owner on public.invoices
  for select to authenticated
  using (public.has_role(workspace_id, 'owner'));

create policy invoice_lines_select_owner on public.invoice_lines
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and public.has_role(i.workspace_id, 'owner')
  ));

create policy payments_select_owner on public.payments
  for select to authenticated
  using (public.has_role(workspace_id, 'owner'));

create policy billing_credits_select_owner on public.billing_credits
  for select to authenticated
  using (public.has_role(workspace_id, 'owner'));

-- gateway_events has no policy at all. Raw webhook payloads are service-role
-- only, and that is the whole intent.

-- --- AI ----------------------------------------------------------------------
-- Readable by the workspace so the credit meter can be shown; writable by
-- nobody. Section 7.2: usage is metered on the server, and the client never
-- reports its own.
create policy ai_credit_ledger_select on public.ai_credit_ledger
  for select to authenticated
  using (public.is_member(workspace_id));

create policy ai_plans_select on public.ai_plans
  for select to authenticated
  using (public.is_member(workspace_id));

create policy ai_plans_insert_editor on public.ai_plans
  for insert to authenticated
  with check (public.has_role(workspace_id, 'editor'));

-- --- notifications -----------------------------------------------------------
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (
    user_id = auth.uid()
    or (user_id is null and public.is_member(workspace_id))
  );

-- Marking as read is the only edit a user may make.
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- notification_deliveries is service-role only: delivery state is the
-- dispatcher's business, not the reader's.

-- --- whatsapp_links ----------------------------------------------------------
-- Read-only from the client. Linking, OTP issue and verification are server
-- actions (Section 8), so a client that could write here could mark its own
-- number verified.
create policy whatsapp_links_select_own on public.whatsapp_links
  for select to authenticated
  using (user_id = auth.uid());

-- The OTP hash never leaves the server.
revoke select on public.whatsapp_links from authenticated, anon;
grant select (
  id, user_id, phone_e164, verified_at, otp_expires_at, otp_attempts,
  revoked_at, created_at, updated_at
) on public.whatsapp_links to authenticated;

-- --- audit_log ---------------------------------------------------------------
-- Readable by admins, written only by the service role. No insert, update or
-- delete policy exists, which is what makes it append-only from the client's
-- point of view.
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (workspace_id is not null and public.has_role(workspace_id, 'admin'));
