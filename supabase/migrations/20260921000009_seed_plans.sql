-- =============================================================================
-- Module 1 / 0009 — package catalogue, BD and Global
--
-- Section 7A.3: the server reads the price from here by region and package, and
-- never from anything the browser sent. This is product configuration, so it
-- ships as a migration rather than as seed data.
--
-- PLACEHOLDER PRICING. The amounts below are structurally correct but
-- commercially invented -- the note fixes the billing *unit* (per connected
-- account per month) and the currencies, not the numbers. Confirm with the
-- founder, and confirm BD VAT treatment with the accountant (Section 7.2),
-- before anything is charged.
--
-- Amounts are minor units: poisha for BDT, cents for USD.
-- =============================================================================

insert into public.plans (
  code, region, currency, display_name, description,
  price_per_seat_minor, ai_credits_per_month, max_seats, sort_order, features
)
values
  -- --- Bangladesh, BDT via SSLCommerz ---------------------------------------
  ('starter', 'bd', 'BDT', 'Starter',
   'One brand, the essentials. Priced per connected account.',
   49900, 200, 3, 10,
   '{"approvals": false, "team": false, "analytics": false}'::jsonb),

  ('growth', 'bd', 'BDT', 'Growth',
   'Team access and approvals for a growing brand.',
   89900, 600, 10, 20,
   '{"approvals": true, "team": true, "analytics": false}'::jsonb),

  ('agency', 'bd', 'BDT', 'Agency',
   'Many brands, many hands. Analytics included.',
   149900, 2000, null, 30,
   '{"approvals": true, "team": true, "analytics": true}'::jsonb),

  -- --- Global, USD via the gateway chosen in Section 13 Q6 ------------------
  ('starter', 'global', 'USD', 'Starter',
   'One brand, the essentials. Priced per connected account.',
   600, 200, 3, 10,
   '{"approvals": false, "team": false, "analytics": false}'::jsonb),

  ('growth', 'global', 'USD', 'Growth',
   'Team access and approvals for a growing brand.',
   1100, 600, 10, 20,
   '{"approvals": true, "team": true, "analytics": false}'::jsonb),

  ('agency', 'global', 'USD', 'Agency',
   'Many brands, many hands. Analytics included.',
   1800, 2000, null, 30,
   '{"approvals": true, "team": true, "analytics": true}'::jsonb)

on conflict (code, region) do update set
  currency             = excluded.currency,
  display_name         = excluded.display_name,
  description          = excluded.description,
  price_per_seat_minor = excluded.price_per_seat_minor,
  ai_credits_per_month = excluded.ai_credits_per_month,
  max_seats            = excluded.max_seats,
  sort_order           = excluded.sort_order,
  features             = excluded.features;
