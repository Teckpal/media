import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Writing to the audit log.
 *
 * One helper, for one reason: `audit_log` has a SELECT policy for admins and
 * **no INSERT policy at all** (migration 0008), which is what makes it
 * append-only from a client's point of view. A write through the
 * request-scoped client is therefore always refused — silently, if the caller
 * does not bind `error`, which is exactly how `post.removed` came to be
 * recorded nowhere despite Section 6.2 requiring it.
 *
 * So the service role writes, and it goes through here so no call site has to
 * remember which client it needed.
 *
 * Failures are logged, never thrown. The audited thing has already happened by
 * the time this runs; turning a missing trail entry into a failed action would
 * mean a member who was removed, with an error on screen saying they were not.
 */
export async function recordAudit(entry: {
  workspaceId: string | null
  actorId: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  source?: 'web' | 'whatsapp' | 'system' | 'support'
  detail?: Record<string, unknown>
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('audit_log')
    .insert({
      workspace_id: entry.workspaceId,
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      source: entry.source ?? 'web',
      detail: (entry.detail ?? {}) as never,
    })

  if (error) {
    console.error('[audit] could not record %s: %s', entry.action, error.message)
  }
}
