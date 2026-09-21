-- =============================================================================
-- Module 5 / 0011 — media storage
--
-- Bytes live in Supabase Storage; `post_media` (0004) holds the metadata the
-- per-platform validators read.
--
-- Objects are keyed `<workspace_id>/<uuid>.<ext>`. The first path segment being
-- the workspace is what makes the policies below possible: membership is
-- decided from the key itself, with no join back to post_media, so an object
-- is governed the moment it is uploaded rather than once a row exists.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media',
  'post-media',
  -- Private. Every read goes through a signed URL, so a leaked object path is
  -- not a permanent public link to a client's unpublished campaign.
  false,
  209715200, -- 200 MB
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime'
  ]
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public             = excluded.public;

-- The workspace this object belongs to, from the first path segment.
create or replace function public.storage_object_workspace(object_name text)
returns uuid
language sql
immutable
as $fn$
  select nullif(split_part(object_name, '/', 1), '')::uuid
$fn$;

-- A malformed key has no workspace, so `is_member(null)` is false and every
-- policy below denies it. Uploading to a path that is not a uuid fails.

create policy "workspace members read their media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and public.is_member(public.storage_object_workspace(name))
  );

-- Section 6.3: editors and above put media in, the same rank that may write
-- the post it belongs to.
create policy "editors upload workspace media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and public.has_role(public.storage_object_workspace(name), 'editor')
  );

create policy "editors replace workspace media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'post-media'
    and public.has_role(public.storage_object_workspace(name), 'editor')
  );

create policy "editors delete workspace media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-media'
    and public.has_role(public.storage_object_workspace(name), 'editor')
  );
