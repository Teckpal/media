-- =============================================================================
-- Data deletion (Section 11, Phase 0)
--
-- Meta will not review an app for the permissions Module 4 needs without a way
-- for a person to have their data removed. Their callback identifies the
-- person by an APP-SCOPED user id — an opaque string that is stable for this
-- app and meaningless to any other — and we were not storing it, so a callback
-- could be verified and then acted on for nobody in particular.
--
-- Two things land here: somewhere to put that id, and a log of the requests so
-- a person who asks can be told what happened rather than trusted to assume.
-- =============================================================================

-- The platform's id for the PERSON who connected the account, where the
-- platform issues one. Not the account's own id (`external_account_id`, a Page
-- or a channel): one person connects many Pages, and a deletion request is
-- about the person.
alter table public.social_accounts
  add column if not exists connected_external_user_id text;

comment on column public.social_accounts.connected_external_user_id is
  'App-scoped id of the platform user who connected this account. Used to '
  'honour a provider-initiated data deletion request. Null for platforms that '
  'issue no such id, and for accounts connected before this column existed.';

-- The lookup a deletion callback makes, and nothing else reads it.
create index if not exists social_accounts_connected_external_user
  on public.social_accounts (platform, connected_external_user_id)
  where connected_external_user_id is not null;

-- --- the requests themselves --------------------------------------------------
create table if not exists public.data_deletion_requests (
  id                  uuid primary key default gen_random_uuid(),

  platform            public.platform not null,
  -- Who the provider said to forget. Kept because the confirmation code must
  -- be answerable later, and because a second request for the same person
  -- should find the first rather than start again.
  external_user_id    text not null,

  -- What the person quotes back to us. Short enough to read down a phone.
  confirmation_code   text not null unique,

  accounts_removed    int not null default 0,
  completed_at        timestamptz,
  -- Set when the request arrived for somebody we hold nothing about, which is
  -- a perfectly good outcome and must not read as a failure.
  nothing_to_remove   boolean not null default false,

  created_at          timestamptz not null default now()
);

create index if not exists data_deletion_requests_subject
  on public.data_deletion_requests (platform, external_user_id);

-- Server-only, like `gateway_events`. RLS is on with no policy, so no browser
-- client reaches it whatever role it holds — a deletion log is a record of
-- other people's requests and belongs to nobody's workspace.
alter table public.data_deletion_requests enable row level security;

revoke all on public.data_deletion_requests from anon, authenticated;
