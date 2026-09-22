import type { OnboardingStep } from '@/lib/constants'

/** Every path the app links to, in one place. */
export const ROUTES = {
  home: '/',
  bdLanding: '/bd',

  login: '/login',
  signup: '/signup',
  verifyEmail: '/verify-email',
  authCallback: '/auth/callback',
  authConfirm: '/auth/confirm',

  onboarding: {
    chooseModule: '/onboarding/module',
    setup: '/onboarding/setup',
    connect: '/onboarding/connect',
    firstDraft: '/onboarding/first-draft',
    paywall: '/onboarding/paywall',
  },

  reconnect: '/reconnect',

  dashboard: '/dashboard',
  posts: '/posts',
  calendar: '/calendar',
  aiPlanner: '/ai-planner',
  connections: '/connections',
  /** Where the OAuth callback lands so the user can choose which pages to add. */
  connectSelect: '/connections/select',
  connectTransfer: '/connections/transfer',
  team: '/team',
  billing: '/billing',
  /**
   * Where a gateway sends the customer back to.
   *
   * Under `/api` and public, because the gateway returns them with a
   * cross-site POST that carries no session cookie. It proves nothing on its
   * own (§7.2) — it re-validates and then hands the browser on to /billing.
   */
  billingReturn: '/api/billing/return',
  settings: '/settings',
} as const

/**
 * Where a user sitting on a given onboarding step should be sent.
 * Section 5, rule 1: the step is saved, so this is how "resume anywhere" works.
 */
export const ONBOARDING_ROUTE: Record<OnboardingStep, string> = {
  verify_email: ROUTES.verifyEmail,
  choose_module: ROUTES.onboarding.chooseModule,
  setup: ROUTES.onboarding.setup,
  connect: ROUTES.onboarding.connect,
  first_draft: ROUTES.onboarding.firstDraft,
  paywall: ROUTES.onboarding.paywall,
  done: ROUTES.dashboard,
}

/** Paths a signed-out visitor may reach. */
export const PUBLIC_PREFIXES = [
  '/',
  '/bd',
  '/login',
  '/signup',
  '/verify-email',
  '/auth',
  '/invite',
  '/legal',
  '/api/webhooks',
  '/api/billing/return',
  '/api/cron',
] as const
