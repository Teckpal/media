-- =============================================================================
-- Module 1 / 0006 — AI credit ledger and AI plans
-- Section 7.2 (metering, top-ups, expiry), Section 13 Q1/Q2, Section 10.
--
-- Credits are whole units, never money. The ledger is append-only: every row
-- is a signed amount, and the balance is their sum. Nothing is ever updated in
-- place, so "why is my balance this number" always has an answer.
-- =============================================================================

create table public.ai_credit_ledger (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,

  kind           public.ai_ledger_kind not null,

  -- Signed. grant/topup/adjust are positive, use/expire are negative.
  amount         int not null,

  -- Section 13 Q2: the monthly package grant expires at cycle end; top-up
  -- credits roll over, so their expires_at is null.
  expires_at     timestamptz,

  -- Free text for grants and top-ups ('plan:starter', 'pack:1000'); for 'use'
  -- it is the feature that spent them ('ai_planner', 'caption_rewrite').
  source         text,

  -- Section 7.2: usage is metered on the server per request. The client never
  -- reports its own usage, so this is always written by server code holding
  -- the model's actual token counts.
  request_id     text,
  model          text,
  input_tokens   int,
  output_tokens  int,

  invoice_id     uuid references public.invoices(id) on delete set null,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint ai_credit_ledger_amount_sign check (
    (kind in ('grant', 'topup') and amount > 0)
    or (kind in ('use', 'expire') and amount < 0)
    or kind = 'adjust'
  ),
  -- Top-ups roll over, so they must never carry an expiry.
  constraint ai_credit_ledger_topups_never_expire check (
    kind <> 'topup' or expires_at is null
  )
);

create index ai_credit_ledger_workspace_idx
  on public.ai_credit_ledger (workspace_id, created_at desc);

-- Drives the cycle-end expiry sweep.
create index ai_credit_ledger_expiring_idx
  on public.ai_credit_ledger (expires_at)
  where kind = 'grant' and expires_at is not null;

-- One 'use' row per request id, so a retried AI call cannot be billed twice.
create unique index ai_credit_ledger_use_once_per_request
  on public.ai_credit_ledger (workspace_id, request_id)
  where kind = 'use' and request_id is not null;

-- Live balance: everything that has not passed its expiry.
--
-- The expiry sweep still writes explicit negative 'expire' rows at cycle end;
-- the filter here is what keeps the number honest in the window between the
-- grant lapsing and the sweep running.
create or replace function public.ai_credit_balance(ws uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(sum(amount), 0)::int
  from public.ai_credit_ledger
  where workspace_id = ws
    and (expires_at is null or expires_at > now())
$fn$;

comment on function public.ai_credit_balance is
  'Section 7.2. Authoritative AI credit balance. When it reaches zero the AI Planner stops and offers a top-up -- there is no silent overage.';

-- --- ai_plans ----------------------------------------------------------------
-- Section 10. The AI Planner is Phase 2; the table lands now so onboarding
-- Step 3 (Section 5, rule 4) has somewhere to record the first plan.
create table public.ai_plans (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  created_by     uuid references public.users(id) on delete set null,

  prompt         text,
  -- What the planner was asked to cover, e.g. one week from a start date.
  period_start   date,
  period_end     date,
  platforms      public.platform[] not null default '{}',

  -- 'pending' | 'ready' | 'failed'
  state          text not null default 'pending',
  -- The raw plan as returned by the model, before it becomes drafts.
  output         jsonb,
  error          text,

  credits_used   int not null default 0 check (credits_used >= 0),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ai_plans_state_valid check (state in ('pending', 'ready', 'failed'))
);

create index ai_plans_workspace_idx on public.ai_plans(workspace_id, created_at desc);

create trigger ai_plans_touch_updated_at
  before update on public.ai_plans
  for each row execute function public.touch_updated_at();

-- Section 6.2: AI output is always a draft. The link is recorded so a plan can
-- be traced to the posts it produced, but nothing about it publishes.
alter table public.posts
  add column ai_plan_id uuid references public.ai_plans(id) on delete set null;

create index posts_ai_plan_idx on public.posts(ai_plan_id) where ai_plan_id is not null;
