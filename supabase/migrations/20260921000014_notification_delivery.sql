-- =============================================================================
-- Module 8 / 0014 — reading, preferring and delivering notifications
-- Sections 8 and 11 (Phase 1: in-app and email).
--
-- Migration 0007 built the notification and the delivery attempt. Three things
-- were missing to actually run them, and one of them was a mistake.
-- =============================================================================

-- --- notification_reads ------------------------------------------------------
-- The mistake.
--
-- `notifications.read_at` is one column on one row, but a notification with a
-- null `user_id` is addressed to the whole workspace -- Modules 4, 6 and 7 all
-- write them that way on purpose, because the person who connected an account
-- or scheduled a post may have left (Section 6.3). "Read" for a shared row is
-- per person, and a single column cannot hold that: the first member to open
-- it would have marked it read for everybody.
--
-- So read state moves here, for every notification, shared or personal.
create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  read_at         timestamptz not null default now(),

  primary key (notification_id, user_id)
);

create index notification_reads_user_idx on public.notification_reads (user_id);

comment on column public.notifications.read_at is
  'Superseded by notification_reads (migration 0014): a workspace-wide notification is read by one member at a time, which one column cannot express. Left in place rather than dropped so nothing silently loses history; the application does not read it.';

alter table public.notification_reads enable row level security;

-- Your own reading, and nobody else's. There is no update or delete policy:
-- marking something read is not something to undo halfway.
create policy notification_reads_select_own on public.notification_reads
  for select to authenticated
  using (user_id = auth.uid());

create policy notification_reads_insert_own on public.notification_reads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    -- Only for a notification you can actually see, so this table cannot be
    -- used to probe which notification ids exist.
    and exists (
      select 1 from public.notifications n
      where n.id = notification_id
        and (n.user_id = auth.uid() or (n.user_id is null and public.is_member(n.workspace_id)))
    )
  );

-- --- notification_preferences ------------------------------------------------
-- Section 11: in-app is not optional -- it is just the app showing its own
-- state -- but email is something a person should be able to turn down without
-- turning off the thing that tells them a post failed.
--
-- Columns rather than a row per category, because the categories are a closed
-- set in Phase 1 and this is read on every dispatch.
create table public.notification_preferences (
  user_id            uuid primary key references public.users(id) on delete cascade,

  -- A post went out, or did not.
  email_publishing   boolean not null default true,
  -- An account needs reconnecting.
  email_connections  boolean not null default true,
  -- Invoices, renewals, grace.
  email_billing      boolean not null default true,
  -- Invites, approvals, membership.
  email_team         boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

alter table public.notification_preferences enable row level security;

create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());

create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());

create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- --- delivery scheduling -----------------------------------------------------
-- `notification_deliveries` counts attempts but had nowhere to record when the
-- next one is due, so a failing provider would have been retried as fast as the
-- cron runs.
alter table public.notification_deliveries
  add column next_attempt_at timestamptz,
  -- Why a delivery was skipped: no eligible recipient, everyone opted out, no
  -- provider configured. A skipped delivery is a decision, and decisions should
  -- be legible afterwards.
  add column skip_reason text;

create index notification_deliveries_due_idx
  on public.notification_deliveries (next_attempt_at nulls first)
  where state = 'pending';

-- --- the fan-out -------------------------------------------------------------
-- Every notification gets its delivery rows the moment it exists.
--
-- A trigger rather than application code: Modules 4, 6 and 7 already insert
-- notifications from four different files, and Module 9 will add more. One of
-- them forgetting to enqueue an email is exactly the kind of omission nobody
-- notices until a customer says "you never told me".
create or replace function public.fan_out_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- In-app is delivered by the row existing. Recorded as sent so the table
  -- describes the whole picture rather than only the parts that involve a
  -- provider.
  insert into public.notification_deliveries (notification_id, channel, state, sent_at)
  values (new.id, 'in_app', 'sent', now())
  on conflict (notification_id, channel) do nothing;

  -- Email is queued, not sent. Who it goes to and whether they want it are
  -- decided by the dispatcher, which can read roles and preferences; a trigger
  -- should not be making that call.
  insert into public.notification_deliveries (notification_id, channel, state)
  values (new.id, 'email', 'pending')
  on conflict (notification_id, channel) do nothing;

  -- WhatsApp is Phase 3 (Section 8). Nothing is queued for it, so no row is
  -- created -- an empty queue is better than one full of rows nothing will
  -- ever pick up.

  return new;
end;
$fn$;

create trigger notifications_fan_out
  after insert on public.notifications
  for each row execute function public.fan_out_notification();

-- --- unread_notification_count -----------------------------------------------
-- The number on the bell.
--
-- It is a left-anti-join, which PostgREST cannot express, and it runs on every
-- page render -- so it is one function rather than two round trips and a merge
-- in JavaScript.
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
    and public.is_member(ws)
    and (n.user_id = auth.uid() or n.user_id is null)
    and not exists (
      select 1 from public.notification_reads r
      where r.notification_id = n.id and r.user_id = auth.uid()
    )
$fn$;

comment on function public.unread_notification_count is
  'Section 11. Unread count for the signed-in member. Returns 0 for a workspace they are not in, rather than refusing.';

-- `is_member` is checked inside, so this is safe to expose to any signed-in
-- user: asking about someone else's workspace returns zero.
revoke execute on function public.unread_notification_count(uuid) from public, anon;
grant execute on function public.unread_notification_count(uuid) to authenticated, service_role;

-- --- claim_notification_deliveries -------------------------------------------
-- The same claim the publish queue uses (migration 0012), for the same reason:
-- two dispatcher ticks must not both send the same email.
create or replace function public.claim_notification_deliveries(
  max_batch    int default 25,
  max_attempts int default 4
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  claimed_ids uuid[];
begin
  with claimed as (
    update public.notification_deliveries d
    set attempts = d.attempts + 1
    where d.id in (
      select due.id
      from public.notification_deliveries due
      where due.state = 'pending'
        and due.attempts < max_attempts
        and coalesce(due.next_attempt_at, due.created_at) <= now()
      order by due.created_at
      limit max_batch
      for update of due skip locked
    )
    returning d.id
  )
  select array_agg(id) into claimed_ids from claimed;

  if claimed_ids is null then
    return;
  end if;

  return query
  select * from public.notification_deliveries where id = any(claimed_ids);
end;
$fn$;

revoke execute on function public.claim_notification_deliveries(int, int)
  from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(int, int) to service_role;

-- A delivery that has spent its attempts is left `pending` by the claim, which
-- would hide it from every report. This settles it.
create or replace function public.fail_exhausted_deliveries(max_attempts int default 4)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  closed int;
begin
  update public.notification_deliveries
  set state = 'failed',
      error = coalesce(error, 'Gave up after repeated failures.')
  where state = 'pending'
    and attempts >= max_attempts;

  get diagnostics closed = row_count;
  return closed;
end;
$fn$;

revoke execute on function public.fail_exhausted_deliveries(int)
  from public, anon, authenticated;
grant execute on function public.fail_exhausted_deliveries(int) to service_role;
