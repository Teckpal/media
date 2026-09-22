// Pure, relative imports, no server-only: who a notification is for and what
// it is about is a decision worth testing on its own.
import type { Role } from '../constants.ts'

/**
 * Section 11, Phase 1: in-app and email.
 *
 * A notification has a `kind` — free text in the schema, because Phase 2 and 3
 * will add more — and two questions follow from it that the dispatcher has to
 * answer before it can send anything:
 *
 *   1. Who in the workspace should hear about this?
 *   2. Is this something they have asked not to be emailed about?
 *
 * Both are answered here. The category is what a person would recognise as a
 * setting ("tell me about billing"); the minimum role is who can actually do
 * something about it, because a notification sent to someone with no way to
 * act on it is just noise with a guilty conscience.
 */

export const NOTIFICATION_CATEGORIES = [
  'publishing',
  'connections',
  'billing',
  'team',
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

const CATEGORY_BY_KIND: Record<string, NotificationCategory> = {
  // Module 6
  post_published: 'publishing',
  post_failed: 'publishing',
  // Module 4
  needs_reconnect: 'connections',
  transfer_update: 'connections',
  // Module 7
  payment_due: 'billing',
  payment_failed: 'billing',
  payment_succeeded: 'billing',
  credits_low: 'billing',
  // Phase 2
  approval_requested: 'team',
  member_invited: 'team',
  member_removed: 'team',
}

/**
 * An unrecognised kind is treated as publishing.
 *
 * Something has to be chosen, and this is the least surprising: it reaches
 * editors, who are the people running the calendar day to day. The alternative
 * — dropping it — would make a new notification kind silently invisible until
 * someone noticed it was missing.
 */
export function categoryOf(kind: string): NotificationCategory {
  return CATEGORY_BY_KIND[kind] ?? 'publishing'
}

/**
 * The lowest role that should hear about a category.
 *
 * Section 6.3 draws the important line: "Admin: everything except billing and
 * deletion." So a renewal reminder goes to the owner and stops there — an
 * admin who cannot pay an invoice does not need to be told one is due.
 */
const MINIMUM_ROLE: Record<NotificationCategory, Role> = {
  // Whoever can reschedule the post that failed.
  publishing: 'editor',
  // Reconnecting an account is an admin's job (Module 4).
  connections: 'admin',
  billing: 'owner',
  team: 'admin',
}

export function minimumRoleFor(category: NotificationCategory): Role {
  return MINIMUM_ROLE[category]
}

/**
 * Kinds that are shown in the app and never emailed.
 *
 * A workspace publishing ten posts a day to two platforms produces twenty
 * successful-publish notifications. Emailing all of them would train every
 * editor to filter the address that also carries "your account needs
 * reconnecting" — so routine success stays in the app, where it is a record
 * rather than an interruption.
 *
 * The notification is still created, still shown, still counted on the bell.
 * Only the email is withheld.
 */
const IN_APP_ONLY = new Set(['post_published'])

export function emailWorthy(kind: string): boolean {
  return !IN_APP_ONLY.has(kind)
}

/** The column on `notification_preferences` that governs this category. */
export const EMAIL_PREFERENCE_COLUMN: Record<NotificationCategory, string> = {
  publishing: 'email_publishing',
  connections: 'email_connections',
  billing: 'email_billing',
  team: 'email_team',
}

/** What the settings screen calls each category, and why it matters. */
export const CATEGORY_LABELS: Record<
  NotificationCategory,
  { title: string; description: string }
> = {
  publishing: {
    title: 'Publishing',
    description: 'When a scheduled post goes out, or does not.',
  },
  connections: {
    title: 'Connections',
    description: 'When an account needs reconnecting before it can publish.',
  },
  billing: {
    title: 'Billing',
    description: 'Renewals, invoices and anything that would pause publishing.',
  },
  team: {
    title: 'Team',
    description: 'Invites, approvals and changes to who can do what.',
  },
}
