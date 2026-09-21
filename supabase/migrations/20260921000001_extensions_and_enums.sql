-- =============================================================================
-- Module 1 / 0001 — extensions, enums, shared helpers
--
-- The enums mirror the string unions in src/lib/constants.ts. Change one,
-- change both. Role and onboarding_step are declared in ascending order so
-- Postgres' native enum ordering gives us `>=` comparisons for free.
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- --- Section 1: the six platforms -------------------------------------------
create type public.platform as enum (
  'facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'youtube'
);

-- --- Section 3: modules. 'self' is admin-assigned only ----------------------
create type public.module_type as enum ('self', 'personal', 'business');

-- --- Section 5: onboarding state machine, in order --------------------------
create type public.onboarding_step as enum (
  'verify_email', 'choose_module', 'setup', 'connect', 'first_draft', 'paywall', 'done'
);

-- --- Section 6.2: post state machine ----------------------------------------
create type public.post_status as enum (
  'draft', 'pending_approval', 'scheduled', 'publishing', 'published',
  'paused', 'failed', 'cancelled', 'removed'
);

-- Per-platform fan-out state. A post can be published on one target and failed
-- on another; post.status is the roll-up.
create type public.target_status as enum (
  'pending', 'publishing', 'published', 'failed', 'cancelled', 'removed'
);

-- --- Section 6.1: connection health -----------------------------------------
create type public.connection_status as enum (
  'active', 'needs_reconnect', 'disconnected', 'transferred'
);

create type public.transfer_status as enum (
  'pending', 'approved', 'rejected', 'cancelled'
);

-- --- Section 6.3: roles, ascending so owner > admin > editor > viewer -------
create type public.workspace_role as enum ('viewer', 'editor', 'admin', 'owner');

-- --- Section 7A: billing ----------------------------------------------------
create type public.billing_region as enum ('bd', 'global');
create type public.currency as enum ('BDT', 'USD');

-- No trial (Section 13 Q3): a subscription is never 'trialing'.
create type public.subscription_status as enum (
  'active', 'past_due', 'grace', 'paused', 'cancelled', 'expired'
);

create type public.invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible');
create type public.payment_status as enum ('pending', 'success', 'failed', 'refunded');

-- 'stub' stands in until Section 13 Q6 is answered.
create type public.payment_gateway as enum (
  'sslcommerz', 'paddle', 'lemonsqueezy', 'stripe', 'stub'
);

-- --- Section 7.2: AI credit ledger ------------------------------------------
-- grant  = monthly package allowance, expires at cycle end
-- topup  = prepaid pack, rolls over
-- use    = server-metered consumption (never client-reported)
-- expire = the cycle-end sweep of unused grants
create type public.ai_ledger_kind as enum ('grant', 'topup', 'use', 'expire', 'adjust');

create type public.notification_channel as enum ('in_app', 'email', 'whatsapp');

-- =============================================================================
-- Shared helpers
-- =============================================================================

-- Touch updated_at on every write.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.touch_updated_at is
  'Trigger helper: stamps updated_at on UPDATE.';
