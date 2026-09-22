-- =============================================================================
-- Module 6 / 0012 — the publish queue
--
-- Section 4's publishing flow and Section 9's "Queue: due posts" cron.
--
-- The queue is the `post_targets` table itself rather than a second table.
-- A separate jobs table would mean two rows that can disagree about whether a
-- post went out, and reconciling them is exactly the bug Section 6.2 is
-- worried about when it says a post must never be published twice.
--
-- What is added here is the bookkeeping a claim needs: a lease, a next-attempt
-- time for backoff, and the container id Instagram publishes through.
-- =============================================================================

alter table public.post_targets
  -- Held by the worker that claimed this target. A worker that dies mid-flight
  -- leaves the row in `publishing` forever, so the claim is time-boxed and the
  -- next tick can take it back.
  add column lease_expires_at timestamptz,

  -- Set when a retryable failure is recorded. The target goes back to
  -- `pending`, but is not due again until this passes (exponential backoff).
  add column next_attempt_at timestamptz,

  -- Instagram publishes in two calls: create a media container, then publish
  -- it. Storing the container id means a retry after an ambiguous failure
  -- publishes *that* container again rather than building a second one, which
  -- is the closest thing Meta offers to an idempotency key.
  add column external_container_id text;

-- The claim query: targets whose post is due, ordered by how late they are.
create index post_targets_due_idx
  on public.post_targets (next_attempt_at nulls first)
  where status in ('pending', 'publishing');

comment on column public.post_targets.lease_expires_at is
  'Claim expiry. A target in publishing past this is assumed abandoned and may be reclaimed.';
comment on column public.post_targets.next_attempt_at is
  'Backoff gate. A pending target is not due until this time.';

-- =============================================================================
-- claim_due_targets — the atomic claim
-- =============================================================================
-- Two workers can tick at once: Vercel can overlap invocations, and the
-- publish-now path runs a tick of its own. `for update ... skip locked` is what
-- makes that safe -- the second worker steps over rows the first is holding
-- rather than waiting for them and then publishing them again.
--
-- Claiming the targets and moving their posts to `publishing` happen in this
-- one function, so they are one transaction. A crash between the two would
-- otherwise leave targets that no post agrees are in flight.
create or replace function public.claim_due_targets(
  max_batch     int default 25,
  lease_seconds int default 300,
  max_attempts  int default 3
)
returns setof public.post_targets
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  claimed_ids uuid[];
begin
  -- The claim and the selection are one statement: the inner select locks the
  -- rows it picks and the outer update takes them, so a row cannot be chosen
  -- by one worker and then claimed by another in between.
  with claimed as (
    update public.post_targets t
    set status           = 'publishing',
        attempts         = t.attempts + 1,
        last_attempt_at  = now(),
        lease_expires_at = now() + make_interval(secs => lease_seconds),
        next_attempt_at  = null
    where t.id in (
      select due.id
      from public.post_targets due
      join public.posts p on p.id = due.post_id
      where p.scheduled_at <= now()
        and due.attempts < max_attempts
        and (
          -- Waiting to go out: either the post is due for the first time, or a
          -- sibling target is in flight and this one has not started.
          (due.status = 'pending'
           and p.status in ('scheduled', 'publishing')
           and coalesce(due.next_attempt_at, p.scheduled_at) <= now())

          -- Abandoned by a worker that never came back.
          or (due.status = 'publishing'
              and p.status = 'publishing'
              and due.lease_expires_at is not null
              and due.lease_expires_at < now())
        )
      -- Latest first would starve the oldest; earliest first clears a backlog
      -- in the order the posts were meant to go out.
      order by p.scheduled_at
      limit max_batch
      for update of due skip locked
    )
    returning t.id
  )
  select array_agg(id) into claimed_ids from claimed;

  if claimed_ids is null then
    return;
  end if;

  -- The posts move second, in the same transaction. `scheduled -> publishing`
  -- is a legal transition, and the lock trigger then refuses every edit, drag,
  -- pause and delete for as long as the fan-out runs (Section 6.2).
  --
  -- Only posts still `scheduled` are touched: the lock trigger raises on any
  -- update to a publishing post that does not change its status, so touching
  -- one whose sibling target claimed it a minute ago would abort the whole
  -- claim.
  update public.posts
  set status = 'publishing'
  where status = 'scheduled'
    and id in (
      select post_id from public.post_targets where id = any(claimed_ids)
    );

  return query
  select * from public.post_targets where id = any(claimed_ids);
end;
$fn$;

comment on function public.claim_due_targets is
  'Claims due publish targets for one worker. SKIP LOCKED, so overlapping ticks never claim the same row.';

-- =============================================================================
-- roll_up_post — one post's status from its targets
-- =============================================================================
-- A post fanned out to Facebook and Instagram can succeed on one and fail on
-- the other. Section 6.2 gives the post a single status, so something has to
-- decide: anything still moving means the post is still publishing, one
-- success is enough to call it published, and only a clean sweep of failures
-- makes it failed.
create or replace function public.roll_up_post(p uuid)
returns public.post_status
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  in_flight  int;
  succeeded  int;
  live       int;
  first_error text;
  current_status public.post_status;
begin
  select status into current_status from public.posts where id = p;
  if current_status is null or current_status <> 'publishing' then
    return current_status;
  end if;

  select
    count(*) filter (where status in ('pending', 'publishing')),
    count(*) filter (where status = 'published'),
    count(*) filter (where status not in ('cancelled', 'removed'))
  into in_flight, succeeded, live
  from public.post_targets
  where post_id = p;

  if in_flight > 0 then
    return current_status;
  end if;

  if succeeded > 0 then
    update public.posts set status = 'published' where id = p and status = 'publishing';
    return 'published';
  end if;

  select last_error into first_error
  from public.post_targets
  where post_id = p and status = 'failed'
  order by updated_at
  limit 1;

  -- `live = 0` means every target was cancelled mid-flight -- a disconnect
  -- landing between the claim and the send. The state machine has no
  -- publishing -> cancelled edge, so it settles as failed with the reason
  -- named rather than sitting in publishing forever.
  update public.posts
  set status     = 'failed',
      last_error = coalesce(
        first_error,
        case when live = 0
          then 'Every account this was going to was disconnected before it could be published.'
          else 'This post could not be published.'
        end
      )
  where id = p and status = 'publishing';

  return 'failed';
end;
$fn$;

comment on function public.roll_up_post is
  'Settles a publishing post once its targets stop moving. One success publishes it; only a clean sweep of failures fails it.';

-- =============================================================================
-- reap_stuck_targets — the backstop
-- =============================================================================
-- A target whose lease expired and whose attempts are spent cannot be claimed
-- again, so without this its post would stay `publishing` -- and therefore
-- locked -- for good. Runs at the top of every tick.
create or replace function public.reap_stuck_targets(max_attempts int default 3)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  affected uuid[];
  dead_count int;
  pid uuid;
begin
  with dead as (
    update public.post_targets
    set status     = 'failed',
        last_error = coalesce(last_error, 'Publishing stopped unexpectedly and could not be retried.')
    where status = 'publishing'
      and lease_expires_at is not null
      and lease_expires_at < now()
      and attempts >= max_attempts
    returning post_id
  )
  select array_agg(distinct post_id), count(*)
  into affected, dead_count
  from dead;

  if affected is null then
    return 0;
  end if;

  -- Each post whose target just died has to be re-settled, or it keeps the
  -- `publishing` status that the dead target was the last reason for.
  foreach pid in array affected loop
    perform public.roll_up_post(pid);
  end loop;

  return dead_count;
end;
$fn$;

comment on function public.reap_stuck_targets is
  'Fails targets abandoned with no attempts left, so their post cannot stay locked in publishing.';

-- =============================================================================
-- Who may call these
-- =============================================================================
-- All three are `security definer`, which means they run as the owner and RLS
-- does not apply inside them. Postgres grants EXECUTE to PUBLIC by default, so
-- without these revokes any signed-in browser could call claim_due_targets
-- over PostgREST and march every workspace's queue forward.
--
-- Only the service role -- the publish worker -- may run them.
revoke execute on function public.claim_due_targets(int, int, int) from public, anon, authenticated;
revoke execute on function public.roll_up_post(uuid)              from public, anon, authenticated;
revoke execute on function public.reap_stuck_targets(int)         from public, anon, authenticated;

grant execute on function public.claim_due_targets(int, int, int) to service_role;
grant execute on function public.roll_up_post(uuid)               to service_role;
grant execute on function public.reap_stuck_targets(int)          to service_role;

-- Same oversight in 0010: the sweep deletes rows and was callable by anyone
-- holding a session. Low stakes, but it is the same mistake, so it is fixed
-- here rather than left as a pattern to copy.
revoke execute on function public.purge_expired_oauth_sessions() from public, anon, authenticated;
grant  execute on function public.purge_expired_oauth_sessions() to service_role;
