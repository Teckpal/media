-- =============================================================================
-- Realtime for notifications
--
-- Section 8 says the workspace is told when something breaks. Until now that
-- meant "told on their next page load", which for a post failing at nine in
-- the morning can be hours. Publishing this one table lets the browser hear
-- about a row the moment it is written.
--
-- ONLY `notifications`. A publication is a firehose pointed at every connected
-- client, and the policies below are the only thing between it and the data —
-- so the table on it is the one whose entire purpose is to be shown to people,
-- and nothing else. Posts, tokens, invoices and the audit log stay off it.
--
-- RLS still applies: Supabase evaluates `notifications_select_own` (migration
-- 0008) per subscriber, so a member receives their own notifications and their
-- workspace's, and nobody else's.
-- =============================================================================

do $$
begin
  -- The publication exists on every Supabase project, but creating it here
  -- means the migration also runs on a bare Postgres — which is how
  -- `scripts/local-db` tests it.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

-- The default replica identity sends the primary key on UPDATE and DELETE,
-- which is all the client needs: it re-reads the row through PostgREST, where
-- RLS applies again. Sending the full old row would put notification bodies
-- on the wire for a change nobody is watching.
