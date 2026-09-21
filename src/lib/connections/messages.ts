import type { ConnectFailure } from '@/lib/platforms/types'

/**
 * Section 6.1 gives each OAuth failure its own screen. This is the copy, in one
 * place, so the onboarding step and the Connections page say the same thing.
 *
 * The `already_connected` wording is load-bearing: it names neither the
 * workspace that holds the account nor who owns it. That is a privacy rule in
 * the note, not a stylistic choice.
 */
export const CONNECT_MESSAGES: Record<
  ConnectFailure | 'forbidden',
  { tone: 'warning' | 'danger'; title: string; body: string }
> = {
  cancelled: {
    tone: 'warning',
    title: 'That connection was cancelled',
    body: 'Nothing was changed. Try again whenever you are ready.',
  },
  wrong_account_type: {
    tone: 'warning',
    title: 'That account type will not work',
    body:
      'Instagram posting needs a Business or Creator account linked to a Facebook Page. Switch it in the Instagram app under Settings, link it to your Page, then try again.',
  },
  missing_permissions: {
    tone: 'warning',
    title: 'Some permissions were not granted',
    body:
      'We need permission to see your Pages and publish to them. Connect again and leave every box ticked.',
  },
  already_connected: {
    tone: 'danger',
    title: 'This account is connected to another workspace',
    body:
      'An account can only be live in one workspace at a time. If it belongs to you, request a transfer and support will check ownership with the platform.',
  },
  invalid_state: {
    tone: 'warning',
    title: 'That connection attempt expired',
    body: 'For your safety the link is only valid for a few minutes. Start again.',
  },
  provider_error: {
    tone: 'danger',
    title: 'The platform could not be reached',
    body: 'Nothing was changed. Try again in a moment.',
  },
  forbidden: {
    tone: 'danger',
    title: 'You do not have permission to do that',
    body: 'Only an owner or admin can change which accounts are connected.',
  },
}

export function connectMessage(key: unknown) {
  return typeof key === 'string' && key in CONNECT_MESSAGES
    ? CONNECT_MESSAGES[key as keyof typeof CONNECT_MESSAGES]
    : undefined
}
