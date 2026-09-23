-- =============================================================================
-- Creating a workspace
--
-- Nobody could. Not through the app.
--
-- `workspaces_insert_as_owner` (migration 0008) lets a signed-in user insert a
-- row they own, and that part worked. But the application asked for the new id
-- back, and `INSERT ... RETURNING` makes Postgres apply the SELECT policy to
-- the row it is about to return. That policy is
--
--     using (is_member(id) or is_platform_admin())
--
-- and at that instant there is no membership row, because the membership row
-- is the next statement. So the insert was refused with
--
--     new row violates row-level security policy for table "workspaces"
--
-- and the only workspace in the database was the one `seed-demo.mjs` made with
-- the service role, which is why it went unnoticed: every screen was exercised
-- against a workspace no user had ever created. MEASURED — reproduced in SQL
-- as the signed-in user, where the same insert succeeds without RETURNING and
-- fails with it.
--
-- The fix is not to widen the SELECT policy. `owner_id` records who made a
-- workspace; `workspace_members` decides who may do anything with it, and
-- every other policy in the schema agrees on that. Adding `owner_id =
-- auth.uid()` to the read rule would introduce a second, quieter answer to
-- "who is in this workspace", which is how the two drift apart later.
--
-- Instead the two inserts become one statement that runs as the definer. That
-- also closes a second hole in the old sequence: it was two round trips, and a
-- failure on the membership insert left a workspace behind with no members at
-- all — invisible to everybody, owned by nobody, impossible to delete through
-- any policy. One function, one transaction, both rows or neither.
-- =============================================================================

create or replace function public.create_workspace(
  p_name     text,
  p_type     public.module_type,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  -- Security definer means RLS is not watching, so every check the policies
  -- would have made is made here instead, explicitly.
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- The owner is always the caller. Passing an owner is not an option the
  -- function offers, so there is nothing to forge.
  if p_type not in ('personal', 'business') then
    -- Section 3: Self (MOTiF) is assigned by a platform admin and never chosen
    -- during signup.
    raise exception 'workspace type % is not available here', p_type
      using errcode = '22023';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a workspace needs a name' using errcode = '22023';
  end if;

  insert into public.workspaces (name, type, owner_id, timezone)
  values (btrim(p_name), p_type, v_user, coalesce(nullif(btrim(p_timezone), ''), 'Asia/Dhaka'))
  returning id into v_id;

  -- Without this row the RLS helpers see no membership and the workspace is
  -- invisible to the person who just made it. It is in the same statement
  -- block as the insert above precisely so that cannot happen.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_id, v_user, 'owner');

  return v_id;
end;
$fn$;

comment on function public.create_workspace(text, public.module_type, text) is
  'Creates a workspace and its owner membership atomically. The owner is always auth.uid().';

-- `public` includes `anon`. The function checks `auth.uid()` and would refuse
-- a signed-out caller anyway, but a security-definer function should not be
-- callable by anyone who has no business calling it.
revoke all on function public.create_workspace(text, public.module_type, text) from public;
grant execute on function public.create_workspace(text, public.module_type, text) to authenticated;
