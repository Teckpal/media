-- =============================================================================
-- Module 1 / 0004 — posts, post_targets, post_media, approvals
-- Section 6.2 (post and calendar rules), Section 6.3 (approvals), Section 10.
-- =============================================================================

-- --- post_media --------------------------------------------------------------
-- Bytes live in Supabase Storage; this is the metadata the per-platform
-- validators read when a scheduled post is edited and has to be re-checked.
create table public.post_media (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  storage_path  text not null,
  mime_type     text not null,
  byte_size     bigint,
  width         int,
  height        int,
  duration_ms   int,
  alt_text      text,
  uploaded_by   uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index post_media_workspace_idx on public.post_media(workspace_id);

-- --- posts -------------------------------------------------------------------
create table public.posts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  created_by        uuid references public.users(id) on delete set null,

  status            public.post_status not null default 'draft',
  caption           text not null default '',
  -- Ordered list of post_media ids. An array rather than a join table because
  -- order is part of the content (carousels) and the list is always read whole.
  media_ids         uuid[] not null default '{}',

  -- Section 6.2: always stored UTC, always displayed in workspaces.timezone.
  scheduled_at      timestamptz,
  published_at      timestamptz,

  -- Section 6.2: AI output is always a draft and is never auto-published.
  is_ai_generated   boolean not null default false,

  -- Section 6.2, delete published post: the row survives for the audit log,
  -- the UI hides it, and the post stays live on the platform.
  removed_at        timestamptz,
  removed_by        uuid references public.users(id) on delete set null,

  cancelled_at      timestamptz,
  paused_at         timestamptz,
  failed_at         timestamptz,
  last_error        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A scheduled or paused post must know when it was meant to go out.
  constraint posts_scheduled_needs_time check (
    status not in ('scheduled', 'paused') or scheduled_at is not null
  )
);

create index posts_workspace_status_idx on public.posts(workspace_id, status);
-- The calendar query: one workspace, one month, hiding removed posts.
create index posts_calendar_idx
  on public.posts (workspace_id, scheduled_at)
  where status not in ('removed', 'cancelled');
-- The queue sweep.
create index posts_due_idx
  on public.posts (scheduled_at)
  where status = 'scheduled';

create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

-- --- the post state machine, enforced in the database ------------------------
-- Mirrors POST_TRANSITIONS in src/lib/constants.ts. Keeping it here as well as
-- in the application is deliberate: Section 4 says a crafted API call must not
-- get further than the UI, and the worker writes with the service role, which
-- skips RLS but not triggers.
create or replace function public.guard_post_transition()
returns trigger
language plpgsql
as $fn$
declare
  allowed public.post_status[];
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := (case old.status
    when 'draft'            then array['pending_approval','scheduled','publishing','cancelled']
    when 'pending_approval' then array['draft','scheduled','cancelled']
    when 'scheduled'        then array['paused','publishing','draft','cancelled']
    when 'publishing'       then array['published','failed']
    when 'published'        then array['removed']
    when 'paused'           then array['scheduled','draft','cancelled']
    when 'failed'           then array['scheduled','draft','cancelled']
    when 'cancelled'        then array[]::text[]
    when 'removed'          then array[]::text[]
  end)::public.post_status[];

  if not (new.status = any(allowed)) then
    raise exception 'illegal post transition % -> % for post %', old.status, new.status, old.id
      using errcode = 'check_violation';
  end if;

  -- Stamp the timestamps that go with each state.
  if new.status = 'paused'    then new.paused_at    := now(); end if;
  if new.status = 'cancelled' then new.cancelled_at := now(); end if;
  if new.status = 'failed'    then new.failed_at    := now(); end if;
  if new.status = 'removed'   then new.removed_at   := coalesce(new.removed_at, now()); end if;
  if new.status = 'published' then new.published_at := coalesce(new.published_at, now()); end if;

  return new;
end;
$fn$;

create trigger posts_guard_transition
  before update on public.posts
  for each row execute function public.guard_post_transition();

-- Section 6.2: while a post is publishing it is locked -- no edit, no drag, no
-- delete, no pause. Only the worker may touch it, and only to move it to
-- published or failed.
create or replace function public.guard_publishing_lock()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'DELETE' then
    if old.status = 'publishing' then
      raise exception 'post % is publishing and cannot be deleted', old.id
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'publishing' then
    if new.status = old.status then
      raise exception 'post % is publishing and is locked for edits', old.id
        using errcode = 'check_violation';
    end if;
    -- Moving out of publishing is allowed, but nothing else may change with it.
    if new.caption is distinct from old.caption
       or new.media_ids is distinct from old.media_ids
       or new.scheduled_at is distinct from old.scheduled_at then
      raise exception 'post % is publishing; content and schedule are locked', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$fn$;

create trigger posts_guard_publishing_lock
  before update or delete on public.posts
  for each row execute function public.guard_publishing_lock();

-- Section 6.2: scheduling into the past is rejected. The UI offers
-- "Publish now" instead, which still meets the publish gate.
--
-- A minute of slack absorbs clock skew and the round-trip between the client
-- picking a time and the server storing it.
create or replace function public.guard_schedule_not_in_past()
returns trigger
language plpgsql
as $fn$
declare
  newly_scheduled boolean;
begin
  if new.status <> 'scheduled' then
    return new;
  end if;

  -- OLD is unassigned on INSERT, so the two paths are kept apart rather than
  -- relying on OR short-circuiting, which SQL does not promise.
  if tg_op = 'INSERT' then
    newly_scheduled := true;
  else
    newly_scheduled := new.scheduled_at is distinct from old.scheduled_at
                    or old.status is distinct from new.status;
  end if;

  if newly_scheduled and new.scheduled_at < now() - interval '1 minute' then
    raise exception 'scheduled_at % is in the past', new.scheduled_at
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create trigger posts_guard_schedule_not_in_past
  before insert or update on public.posts
  for each row execute function public.guard_schedule_not_in_past();

-- --- post_targets ------------------------------------------------------------
-- One row per (post, social account). A post can succeed on Facebook and fail
-- on Instagram, so each target carries its own status, attempts and error.
create table public.post_targets (
  id                 uuid primary key default gen_random_uuid(),
  post_id            uuid not null references public.posts(id) on delete cascade,
  social_account_id  uuid not null references public.social_accounts(id) on delete restrict,

  -- Denormalised so the worker and the analytics queries do not have to join
  -- back through social_accounts for something that can never change.
  platform           public.platform not null,

  status             public.target_status not null default 'pending',

  -- Section 6.2, double publish. Generated once when the target is created and
  -- sent with every publish attempt, so a retry after an ambiguous timeout
  -- cannot post twice.
  idempotency_key    text not null unique,

  attempts           int not null default 0,
  last_attempt_at    timestamptz,
  last_error         text,

  -- What the platform gave back.
  external_post_id   text,
  external_permalink text,
  published_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint post_targets_attempts_sane check (attempts >= 0 and attempts <= 10),
  unique (post_id, social_account_id)
);

create index post_targets_post_idx on public.post_targets(post_id);
create index post_targets_account_idx on public.post_targets(social_account_id);
create index post_targets_pending_idx
  on public.post_targets (status)
  where status in ('pending', 'publishing');

create trigger post_targets_touch_updated_at
  before update on public.post_targets
  for each row execute function public.touch_updated_at();

-- --- approvals ---------------------------------------------------------------
-- Section 6.3. An editor scheduling into a workspace with approvals on lands in
-- pending_approval; editing an approved post sends it back unless the editor is
-- an admin or owner.
create table public.approvals (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  requested_by  uuid references public.users(id) on delete set null,
  decided_by    uuid references public.users(id) on delete set null,

  -- 'pending' | 'approved' | 'rejected' | 'superseded'
  -- 'superseded' is what a prior decision becomes when the post is edited
  -- again, so the history of who approved what survives.
  state         text not null default 'pending',
  note          text,

  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,

  constraint approvals_state_valid
    check (state in ('pending', 'approved', 'rejected', 'superseded'))
);

create index approvals_post_idx on public.approvals(post_id);
create index approvals_workspace_pending_idx
  on public.approvals (workspace_id)
  where state = 'pending';

-- At most one open approval per post.
create unique index approvals_one_pending_per_post
  on public.approvals (post_id)
  where state = 'pending';
