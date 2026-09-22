-- =============================================================================
-- Module 7 / 0013 — the operations money actually needs
-- Sections 7, 7A, 13 Q5.
--
-- Everything here exists because supabase-js has no transaction. Marking an
-- invoice paid, extending the subscription, locking the region, paying the
-- seats and granting the month's AI credits are one event; done as five
-- separate writes, a failure in the middle leaves a customer charged and not
-- activated. So the arithmetic stays in `src/lib/billing/pricing.ts`, where it
-- is pure and tested, and the *application* of it happens here, atomically.
-- =============================================================================

-- --- publishing_coverage -----------------------------------------------------
-- A fix for something Module 5 got wrong.
--
-- Gate 2 (`canPublish`) reads `subscriptions`, but migration 0008 makes that
-- table owner-only, because Section 6.3 says "Admin: everything except billing
-- and deletion." The effect was that an editor opening the composer saw no
-- subscription and was told to buy a plan the workspace already has.
--
-- Whether publishing is covered is not a financial detail — it is a fact about
-- what the app will let you do. This exposes exactly that, and no amounts, to
-- any member. The invoice table's owner-only policy is untouched.
create or replace function public.publishing_coverage(ws uuid)
returns table (
  status               public.subscription_status,
  grace_until          timestamptz,
  current_period_end   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- A signed-in caller may only ask about a workspace they belong to. A caller
  -- with no user in scope is the service role -- the publish worker, asking
  -- about a workspace nobody is signed in to -- and EXECUTE is granted to
  -- nobody else.
  if auth.uid() is not null and not public.is_member(ws) then
    return;
  end if;

  return query
  select s.status, s.grace_until, s.current_period_end
  from public.subscriptions s
  where s.workspace_id = ws
    and s.status in ('active', 'past_due', 'grace')
  limit 1;
end;
$fn$;

comment on function public.publishing_coverage is
  'Gate 2''s question, answerable by any member: is publishing covered, and until when. Exposes no amounts.';

-- --- consume_billing_credits -------------------------------------------------
-- Section 13 Q5: a downgrade becomes credit on the next invoice.
--
-- Reserved when the invoice is raised rather than when it is paid, because the
-- amount the customer is asked for already has the credit taken off it. Two
-- checkouts started at once would otherwise both see the same credit
-- available and both discount by it; `for update` is what stops that.
create or replace function public.consume_billing_credits(
  ws        uuid,
  inv       uuid,
  cur       public.currency,
  max_minor bigint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  budget    bigint := greatest(max_minor, 0);
  taken     bigint := 0;
  row_taken bigint;
  credit    record;
begin
  if budget = 0 then
    return 0;
  end if;

  for credit in
    select id, remaining_minor
    from public.billing_credits
    where workspace_id = ws
      and currency = cur
      and remaining_minor > 0
    order by created_at
    for update
  loop
    exit when budget = 0;

    row_taken := least(credit.remaining_minor, budget);

    update public.billing_credits
    set remaining_minor    = remaining_minor - row_taken,
        applied_invoice_id = coalesce(applied_invoice_id, inv)
    where id = credit.id;

    taken  := taken + row_taken;
    budget := budget - row_taken;
  end loop;

  return taken;
end;
$fn$;

-- --- release_billing_credits -------------------------------------------------
-- An invoice that is voided -- typically because the customer started checkout
-- again -- gives its credit back. Without this, abandoning a checkout would
-- quietly burn the credit it had reserved.
create or replace function public.release_billing_credits(inv uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  budget     bigint;
  given_back bigint := 0;
  restore    bigint;
  credit     record;
begin
  select credit_applied_minor into budget from public.invoices where id = inv;

  if not found or coalesce(budget, 0) = 0 then
    return 0;
  end if;

  -- Capped at what this invoice actually applied, so a release can never hand
  -- back more credit than was taken. Checkout voids the previous open invoice
  -- before raising a new one, so at most one invoice is ever holding a
  -- workspace's credit -- this cap is the belt to that braces.
  for credit in
    select id, amount_minor, remaining_minor
    from public.billing_credits
    where applied_invoice_id = inv
    order by created_at
    for update
  loop
    exit when budget = 0;

    restore := least(credit.amount_minor - credit.remaining_minor, budget);
    if restore <= 0 then
      continue;
    end if;

    update public.billing_credits
    set remaining_minor    = remaining_minor + restore,
        -- Whole again, so it belongs to no invoice.
        applied_invoice_id = case
          when remaining_minor + restore >= amount_minor then null
          else applied_invoice_id
        end
    where id = credit.id;

    given_back := given_back + restore;
    budget     := budget - restore;
  end loop;

  update public.invoices
  set credit_applied_minor = credit_applied_minor - given_back
  where id = inv;

  return given_back;
end;
$fn$;

-- --- activate_paid_invoice ---------------------------------------------------
-- The whole of "they paid" in one transaction.
--
-- Idempotent by design: a gateway that sends its IPN twice, or an IPN that
-- races the customer's own return from the payment page, must activate exactly
-- one subscription. The invoice's own status is the lock.
create or replace function public.activate_paid_invoice(
  p_payment      uuid,
  p_plan         uuid,
  p_seats        int,
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_ai_credits   int,
  p_region       public.billing_region,
  p_gateway      public.payment_gateway,
  p_source       text default 'plan'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payment      record;
  v_invoice      record;
  v_workspace    record;
  v_subscription record;
  v_currency     public.currency;
  v_region_note  text := null;
begin
  select * into v_payment from public.payments where id = p_payment for update;
  if not found then
    raise exception 'payment % does not exist', p_payment using errcode = 'no_data_found';
  end if;

  if v_payment.invoice_id is null then
    raise exception 'payment % is not attached to an invoice', p_payment
      using errcode = 'check_violation';
  end if;

  select * into v_invoice from public.invoices where id = v_payment.invoice_id for update;

  -- Already done. Said plainly rather than by doing it all again: a second
  -- grant of AI credits or a second month of subscription would be a real
  -- error, not a harmless repeat.
  if v_invoice.status = 'paid' then
    update public.payments
    set status = 'success', validated_at = coalesce(validated_at, now())
    where id = p_payment and status <> 'success';

    return jsonb_build_object('applied', false, 'reason', 'invoice already paid');
  end if;

  if v_invoice.status = 'void' then
    return jsonb_build_object('applied', false, 'reason', 'invoice was voided');
  end if;

  v_currency := v_invoice.currency;

  update public.payments
  set status = 'success', validated_at = coalesce(validated_at, now())
  where id = p_payment;

  update public.invoices
  set status = 'paid', paid_at = now()
  where id = v_invoice.id;

  select * into v_workspace from public.workspaces
  where id = v_invoice.workspace_id for update;

  -- Section 7A.2 rule 4: the region freezes at the first successful payment.
  -- Rule 3 says the payment method decides it, and the gateway that took the
  -- money is that method -- SSLCommerz cannot settle a non-BD card.
  if v_workspace.billing_region_locked_at is null then
    update public.workspaces
    set billing_region           = p_region,
        billing_region_locked_at = now()
    where id = v_workspace.id;
  elsif v_workspace.billing_region is distinct from p_region then
    -- Locked to something else. The payment is real and is not being thrown
    -- away over it; it is flagged for support, because the trigger on
    -- `workspaces` will not let even this function change a locked region.
    v_region_note := format(
      'paid through the %s region gateway while locked to %s',
      p_region, v_workspace.billing_region
    );
  end if;

  select * into v_subscription from public.subscriptions
  where workspace_id = v_invoice.workspace_id
    and status in ('active', 'past_due', 'grace')
  for update;

  if not found then
    insert into public.subscriptions (
      workspace_id, plan_id, region, currency, gateway, seats, status,
      current_period_start, current_period_end, grace_until
    )
    values (
      v_invoice.workspace_id, p_plan, coalesce(v_workspace.billing_region, p_region),
      v_currency, p_gateway, greatest(p_seats, 0), 'active',
      p_period_start, p_period_end, null
    )
    returning * into v_subscription;
  else
    update public.subscriptions
    set plan_id              = p_plan,
        seats                = greatest(p_seats, 0),
        status               = 'active',
        gateway              = p_gateway,
        current_period_start = p_period_start,
        current_period_end   = p_period_end,
        grace_until          = null
    where id = v_subscription.id
    returning * into v_subscription;
  end if;

  update public.invoices
  set subscription_id = v_subscription.id
  where id = v_invoice.id and subscription_id is null;

  -- Section 7.1: the billing unit is the connected account. The oldest
  -- connections get the seats, so a workspace that connected more accounts
  -- than it paid for keeps the ones it has been using (the rest stay
  -- draft-only, which is what Section 7.2 says).
  update public.social_accounts
  set paid_seat       = true,
      seat_paid_until = p_period_end
  where id in (
    select id from public.social_accounts
    where workspace_id = v_invoice.workspace_id
      and status in ('active', 'needs_reconnect')
    order by connected_at
    limit greatest(p_seats, 0)
  );

  -- Section 7.1 / 13 Q2: the month's allowance, expiring at cycle end. Guarded
  -- by the invoice so a replayed callback cannot grant it twice.
  if p_ai_credits > 0
     and not exists (
       select 1 from public.ai_credit_ledger
       where invoice_id = v_invoice.id and kind = 'grant'
     ) then
    insert into public.ai_credit_ledger (
      workspace_id, kind, amount, expires_at, source, invoice_id
    )
    values (
      v_invoice.workspace_id, 'grant', p_ai_credits, p_period_end, p_source, v_invoice.id
    );
  end if;

  insert into public.audit_log (
    workspace_id, actor_id, action, entity_type, entity_id, source, detail
  )
  values (
    v_invoice.workspace_id, null, 'billing.activated', 'invoice', v_invoice.id, 'gateway',
    jsonb_build_object(
      'payment_id', p_payment,
      'seats', greatest(p_seats, 0),
      'period_end', p_period_end,
      'gateway', p_gateway,
      'region_note', v_region_note
    )
  );

  return jsonb_build_object(
    'applied', true,
    'subscription_id', v_subscription.id,
    'invoice_id', v_invoice.id,
    'seats', greatest(p_seats, 0),
    'period_end', p_period_end,
    'region_note', v_region_note
  );
end;
$fn$;

comment on function public.activate_paid_invoice is
  'Section 7.2. Marks the invoice paid, extends the subscription, locks the region, pays the seats and grants AI credits -- once, whatever the gateway sends.';

-- --- expire_lapsed_ai_grants -------------------------------------------------
-- Section 13 Q2: the monthly grant expires at cycle end; top-ups roll over.
--
-- `ai_credit_balance` already ignores a lapsed grant, so this changes no
-- balance. It writes the matching negative row, so the ledger explains itself:
-- "why did my credits drop" has an answer in the ledger rather than only in
-- the code that reads it.
create or replace function public.expire_lapsed_ai_grants()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  written int := 0;
  grant_row record;
begin
  for grant_row in
    select id, workspace_id, amount, expires_at
    from public.ai_credit_ledger g
    where g.kind = 'grant'
      and g.expires_at is not null
      and g.expires_at < now()
      -- The matching 'expire' row names the grant it cancels, so a second
      -- sweep over the same grant writes nothing.
      and not exists (
        select 1 from public.ai_credit_ledger spent
        where spent.kind = 'expire'
          and spent.source = 'grant:' || g.id::text
      )
  loop
    insert into public.ai_credit_ledger (workspace_id, kind, amount, source)
    values (
      grant_row.workspace_id,
      'expire',
      -grant_row.amount,
      'grant:' || grant_row.id::text
    );
    written := written + 1;
  end loop;

  return written;
end;
$fn$;

-- =============================================================================
-- Who may call these
-- =============================================================================
-- Every function here is `security definer` and Postgres grants EXECUTE to
-- PUBLIC by default. Left alone, any signed-in browser could call
-- `activate_paid_invoice` over PostgREST and give itself a subscription.
revoke execute on function
  public.consume_billing_credits(uuid, uuid, public.currency, bigint)
  from public, anon, authenticated;
revoke execute on function public.release_billing_credits(uuid)
  from public, anon, authenticated;
revoke execute on function public.activate_paid_invoice(
  uuid, uuid, int, timestamptz, timestamptz, int, public.billing_region,
  public.payment_gateway, text
) from public, anon, authenticated;
revoke execute on function public.expire_lapsed_ai_grants()
  from public, anon, authenticated;

grant execute on function
  public.consume_billing_credits(uuid, uuid, public.currency, bigint) to service_role;
grant execute on function public.release_billing_credits(uuid) to service_role;
grant execute on function public.activate_paid_invoice(
  uuid, uuid, int, timestamptz, timestamptz, int, public.billing_region,
  public.payment_gateway, text
) to service_role;
grant execute on function public.expire_lapsed_ai_grants() to service_role;

-- The exception: gate 2 runs in the browser's own request, so a member has to
-- be able to ask it. It exposes no amounts, and it checks membership itself.
revoke execute on function public.publishing_coverage(uuid) from public, anon;
grant execute on function public.publishing_coverage(uuid) to authenticated, service_role;
