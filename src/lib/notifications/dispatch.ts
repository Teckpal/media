import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { emailConfigured, sendEmail } from '@/lib/notifications/email'
import { resolveEmailAudience } from '@/lib/notifications/recipients'
import { emailWorthy } from '@/lib/notifications/kinds'
import { renderNotificationEmail } from '@/lib/notifications/templates'
// Exponential backoff, from the publish worker. The same shape of problem —
// a provider that is briefly unhappy — so the same curve rather than a second
// one that drifts out of step with it.
import { backoffMs } from '@/lib/publish/policy'
import { appUrl } from '@/lib/env'
import type { NotificationDeliveryRow } from '@/types/database'

/**
 * Section 11, Phase 1: the email half of notifications.
 *
 * In-app needs no dispatcher — the notification row *is* the delivery. This
 * turns the queued email rows (migration 0014's trigger writes one per
 * notification) into actual messages.
 *
 * Claimed the same way the publish queue claims targets, for the same reason:
 * two ticks that overlap must not both send the same email.
 */

const MAX_ATTEMPTS = 4
const DEFAULT_BATCH = 25

export type DispatchSummary = {
  claimed: number
  sent: number
  skipped: number
  retrying: number
  failed: number
  exhausted: number
}

export async function runNotificationTick(
  options: { limit?: number } = {},
): Promise<DispatchSummary> {
  const admin = createAdminClient()

  const { data: exhausted } = await admin.rpc('fail_exhausted_deliveries', {
    max_attempts: MAX_ATTEMPTS,
  })

  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    skipped: 0,
    retrying: 0,
    failed: 0,
    exhausted: exhausted ?? 0,
  }

  const { data: claimed, error } = await admin.rpc('claim_notification_deliveries', {
    max_batch: options.limit ?? DEFAULT_BATCH,
    max_attempts: MAX_ATTEMPTS,
  })

  if (error) {
    console.error('[notify] claim failed: %s', error.message)
    return summary
  }

  summary.claimed = claimed?.length ?? 0

  for (const delivery of claimed ?? []) {
    try {
      const outcome = await deliver(delivery)
      summary[outcome] += 1
    } catch (cause) {
      console.error('[notify] delivery %s threw: %s', delivery.id, String(cause))
      await settle(delivery.id, {
        state: 'failed',
        error: 'Something went wrong on our side while sending this.',
      })
      summary.failed += 1
    }
  }

  return summary
}

type DeliveryOutcome = 'sent' | 'skipped' | 'retrying' | 'failed'

type ClaimedDelivery = {
  id: string
  notification_id: string
  channel: string
  attempts: number
}

async function deliver(delivery: ClaimedDelivery): Promise<DeliveryOutcome> {
  const admin = createAdminClient()

  // Only email is queued. The trigger writes in-app rows already marked sent,
  // and WhatsApp is Phase 3 with nothing queueing for it — so anything else
  // here is a row nobody meant to create.
  if (delivery.channel !== 'email') {
    await settle(delivery.id, {
      state: 'skipped',
      skip_reason: `Nothing dispatches the ${delivery.channel} channel yet.`,
    })
    return 'skipped'
  }

  if (!emailConfigured()) {
    // Said out loud rather than retried. Without a provider this will not work
    // in four minutes either, and a queue full of pending rows would hide the
    // fact that nobody is being told anything.
    await settle(delivery.id, {
      state: 'skipped',
      skip_reason: 'No email provider is configured.',
    })
    return 'skipped'
  }

  const { data: notification } = await admin
    .from('notifications')
    .select('id, workspace_id, user_id, kind, title, body, link_path')
    .eq('id', delivery.notification_id)
    .maybeSingle()

  if (!notification) {
    await settle(delivery.id, {
      state: 'skipped',
      skip_reason: 'The notification no longer exists.',
    })
    return 'skipped'
  }

  if (!emailWorthy(notification.kind)) {
    await settle(delivery.id, {
      state: 'skipped',
      skip_reason: 'Shown in the app rather than emailed.',
    })
    return 'skipped'
  }

  const audience = await resolveEmailAudience(notification)

  if (audience.recipients.length === 0) {
    await settle(delivery.id, {
      state: 'skipped',
      skip_reason: audience.skipReason ?? 'Nobody to send this to.',
    })
    return 'skipped'
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('name')
    .eq('id', notification.workspace_id)
    .maybeSingle()

  const content = renderNotificationEmail({
    title: notification.title,
    body: notification.body,
    linkPath: notification.link_path,
    appUrl: appUrl(),
    workspaceName: workspace?.name ?? null,
  })

  let providerId: string | null = null
  let delivered = 0
  const failures: string[] = []
  let anyRetryable = false

  for (const recipient of audience.recipients) {
    const outcome = await sendEmail({ to: recipient.email, content })

    if (outcome.ok) {
      delivered += 1
      providerId ??= outcome.providerId
      continue
    }

    failures.push(outcome.error)
    anyRetryable ||= outcome.retryable
  }

  /*
   * A partial success counts as sent.
   *
   * There is one delivery row for the whole channel, so retrying it would
   * re-send to everyone who already received it. Between a duplicate email to
   * three people and a missing one to the fourth, neither is good — but the
   * failure is recorded against the row, and it is almost always a problem
   * with one address rather than with the queue. A retry would not fix that
   * address and would annoy everybody else.
   */
  if (delivered > 0) {
    await settle(delivery.id, {
      state: 'sent',
      provider_id: providerId,
      error: failures.length > 0 ? `Some recipients failed: ${failures.join('; ')}` : null,
      sent_at: new Date().toISOString(),
    })
    return 'sent'
  }

  if (anyRetryable && delivery.attempts < MAX_ATTEMPTS) {
    await settle(delivery.id, {
      state: 'pending',
      error: failures.join('; '),
      next_attempt_at: new Date(Date.now() + backoffMs(delivery.attempts)).toISOString(),
    })
    return 'retrying'
  }

  await settle(delivery.id, { state: 'failed', error: failures.join('; ') })
  return 'failed'
}

async function settle(
  deliveryId: string,
  patch: {
    state: NotificationDeliveryRow['state']
    provider_id?: string | null
    error?: string | null
    skip_reason?: string | null
    sent_at?: string | null
    next_attempt_at?: string | null
  },
): Promise<void> {
  await createAdminClient()
    .from('notification_deliveries')
    .update(patch)
    .eq('id', deliveryId)
}
