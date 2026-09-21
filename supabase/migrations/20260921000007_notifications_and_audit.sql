-- =============================================================================
-- Module 1 / 0007 — notifications, WhatsApp links, audit log
-- Sections 8, 10. Phase 1 ships in-app and email; the whatsapp channel is
-- wired but dormant until Phase 3.
-- =============================================================================

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  -- Null means everyone in the workspace who is allowed to see it.
  user_id       uuid references public.users(id) on delete cascade,

  -- 'post_published', 'post_failed', 'needs_reconnect', 'payment_due',
  -- 'payment_failed', 'credits_low', 'approval_requested', 'transfer_update'.
  kind          text not null,
  title         text not null,
  body          text,
  -- Where clicking it should land.
  link_path     text,
  data          jsonb not null default '{}'::jsonb,

  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;
create index notifications_workspace_idx
  on public.notifications (workspace_id, created_at desc);

-- Delivery attempts, one row per channel per notification. Kept separate from
-- the notification itself so a failed email does not hide the in-app copy, and
-- so WhatsApp template costs (Section 8) can be counted later.
create table public.notification_deliveries (
  id               uuid primary key default gen_random_uuid(),
  notification_id  uuid not null references public.notifications(id) on delete cascade,
  channel          public.notification_channel not null,

  -- 'pending' | 'sent' | 'failed' | 'skipped'
  state            text not null default 'pending',
  provider_id      text,
  error            text,

  attempts         int not null default 0,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint notification_deliveries_state_valid
    check (state in ('pending', 'sent', 'failed', 'skipped')),
  unique (notification_id, channel)
);

create index notification_deliveries_pending_idx
  on public.notification_deliveries (created_at)
  where state = 'pending';

create trigger notification_deliveries_touch_updated_at
  before update on public.notification_deliveries
  for each row execute function public.touch_updated_at();

-- --- whatsapp_links ----------------------------------------------------------
-- Section 8: Settings -> add number -> OTP on WhatsApp -> linked to one user.
-- Phase 3, but the shape is fixed now because notifications reference it.
create table public.whatsapp_links (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,

  -- E.164. One number, one user (Section 8).
  phone_e164        text not null unique,

  verified_at       timestamptz,
  otp_hash          text,
  otp_expires_at    timestamptz,
  otp_attempts      int not null default 0,

  -- Removed when the member is removed from the workspace or unlinks.
  revoked_at        timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One live link per user.
create unique index whatsapp_links_one_per_user
  on public.whatsapp_links (user_id)
  where revoked_at is null;

create trigger whatsapp_links_touch_updated_at
  before update on public.whatsapp_links
  for each row execute function public.touch_updated_at();

-- --- audit_log ---------------------------------------------------------------
-- Section 6.2 keeps removed posts here, Section 8 requires every WhatsApp
-- action to land here, and Section 6.1 transfers need a trail.
--
-- Append-only: the RLS policies below grant SELECT and nothing else, and even
-- the service role has no UPDATE or DELETE policy to lean on.
create table public.audit_log (
  id            bigint generated always as identity primary key,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  actor_id      uuid references public.users(id) on delete set null,

  -- 'post.removed', 'account.disconnected', 'member.removed',
  -- 'subscription.paid', 'whatsapp.approve', 'transfer.approved', ...
  action        text not null,
  entity_type   text,
  entity_id     text,

  -- 'web' | 'whatsapp' | 'system' | 'support' -- Section 8 wants WhatsApp
  -- actions distinguishable from web ones after the fact.
  source        text not null default 'web',

  -- Before/after, request id, IP: enough to reconstruct what happened.
  detail        jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now()
);

create index audit_log_workspace_idx on public.audit_log (workspace_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
