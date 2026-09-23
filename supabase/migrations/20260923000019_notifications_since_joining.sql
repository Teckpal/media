-- =============================================================================
-- A new member sees what happened after they arrived, and nothing before it
--
-- `notifications_select_own` (migration 0008) reads
--
--     user_id = auth.uid() or (user_id is null and is_member(workspace_id))
--
-- and membership is a yes or a no, with no date on it. So the moment somebody
-- accepted an invitation, every workspace notification ever written became
-- visible to them at once: who had been removed, which posts had failed, what
-- the team had been doing for months before they were asked to join.
--
-- That is a disclosure, not a convenience. An invitation grants a role from
-- the day it is accepted; it is not a key to the archive. It is also a poor
-- first impression — a bell showing ninety unread items about work the person
-- has never seen is a bell they turn off.
--
-- `workspace_members.joined_at` already records the answer. Both the policy
-- and the bell's count now use it.
--
-- Notifications addressed to a specific person (`user_id = auth.uid()`) are
-- untouched. Those were written *to them*, so when they joined has nothing to
-- do with it.
--
-- Rejoining is treated the same way, and deliberately: removing somebody
-- deletes their membership row, so accepting a fresh invitation writes a new
-- `joined_at` and the gap they were away stays closed to them.
-- =============================================================================

-- --- member_since ------------------------------------------------------------
-- Null for somebody who is not a member. That is what makes the comparisons
-- below correct without a second membership check: `created_at >= null` is
-- null, which is not true, so the row is excluded.
create or replace function public.member_since(ws uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select joined_at
  from public.workspace_members
  where workspace_id = ws and user_id = auth.uid()
$fn$;

comment on function public.member_since is
  'When the signed-in user joined this workspace, or null if they are not in it.';

revoke all on function public.member_since(uuid) from public;
grant execute on function public.member_since(uuid) to authenticated;

-- --- the policy ---------------------------------------------------------------
drop policy if exists notifications_select_own on public.notifications;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (
    -- Addressed to this person: theirs regardless of dates.
    user_id = auth.uid()
    -- Addressed to the workspace: theirs from the day they joined.
    or (user_id is null and created_at >= public.member_since(workspace_id))
  );

-- --- the bell -----------------------------------------------------------------
-- Kept in step by hand, because it is a separate definition of the same
-- question. A count that included rows the list cannot show would put a number
-- on the bell that leads to an empty panel — the exact shape of bug that makes
-- people stop trusting a notification system.
create or replace function public.unread_notification_count(ws uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select count(*)::int
  from public.notifications n
  where n.workspace_id = ws
    and (
      n.user_id = auth.uid()
      or (n.user_id is null and n.created_at >= public.member_since(ws))
    )
    and not exists (
      select 1 from public.notification_reads r
      where r.notification_id = n.id and r.user_id = auth.uid()
    )
$fn$;

comment on function public.unread_notification_count is
  'Section 11. Unread count for the signed-in member, from the day they joined. Returns 0 for a workspace they are not in, rather than refusing.';
