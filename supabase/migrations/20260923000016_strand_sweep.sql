-- =============================================================================
-- reap_stranded_posts — the gap Module 6 left open
--
-- A post is `scheduled`, and every target it had is gone: cancelled by a
-- disconnect, or removed with the account. Nothing will ever claim it, because
-- `claim_due_targets` claims TARGETS, and there are none. So it sits in the
-- calendar looking scheduled for ever, and the person who wrote it believes it
-- is going out.
--
-- Reaching this state needs two failures at once — the paths that cancel
-- targets also pause the post — which is exactly why it wants a sweep rather
-- than another guard. A rule that only fires when something else has already
-- gone wrong cannot be tested by the thing that went wrong.
--
-- `paused`, not `failed`. Nothing was attempted, so nothing failed; and
-- Section 6.2 says a paused post is resumed by a person choosing a new time,
-- which is the right next step for a post whose accounts went away.
-- =============================================================================

create or replace function public.reap_stranded_posts()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  swept int;
begin
  with stranded as (
    select p.id
    from public.posts p
    where p.status = 'scheduled'
      and p.scheduled_at is not null
      -- Past due by a clear margin. A post whose minute has merely arrived is
      -- the publish worker's business, and racing it would pause something it
      -- is in the middle of sending.
      and p.scheduled_at < now() - interval '30 minutes'
      and not exists (
        select 1
        from public.post_targets t
        where t.post_id = p.id
          and t.status in ('pending', 'publishing')
      )
    for update skip locked
  )
  update public.posts p
     set status = 'paused',
         paused_at = now(),
         last_error = 'The accounts this was going to are no longer connected.'
    from stranded s
   where p.id = s.id
     -- Re-checked inside the update: between the scan and the write the worker
     -- may have moved it on, and this must lose that race rather than win it.
     and p.status = 'scheduled';

  get diagnostics swept = row_count;
  return swept;
end;
$fn$;

comment on function public.reap_stranded_posts is
  'Pauses a scheduled post that has no target left to publish it. Nothing else '
  'would ever move it, so it would sit in the calendar looking scheduled.';

revoke execute on function public.reap_stranded_posts() from public, anon, authenticated;
grant  execute on function public.reap_stranded_posts() to service_role;
