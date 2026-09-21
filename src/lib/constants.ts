/**
 * Domain vocabulary, straight from the project note.
 * These string unions are mirrored by Postgres enums in the migrations —
 * change one, change both.
 */

// --- Section 1: platforms ---------------------------------------------------
export const PLATFORMS = [
  'facebook',
  'instagram',
  'twitter',
  'linkedin',
  'tiktok',
  'youtube',
] as const
export type Platform = (typeof PLATFORMS)[number]

/** Phase 1 ships Facebook + Instagram only (Section 11). */
export const PHASE_1_PLATFORMS: Platform[] = ['facebook', 'instagram']

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'X (Twitter)',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}

// --- Section 3: modules -----------------------------------------------------
export const MODULES = ['self', 'personal', 'business'] as const
export type Module = (typeof MODULES)[number]

/** Never offered in public signup — admin assignment only (Section 3). */
export const PUBLIC_MODULES: Module[] = ['personal', 'business']

// --- Section 5: onboarding state machine ------------------------------------
export const ONBOARDING_STEPS = [
  'verify_email',
  'choose_module',
  'setup',       // Step 1: business / personal setup
  'connect',     // Step 2: connect >= 1 account, no skip
  'first_draft', // Step 3: soft, output is always a draft
  'paywall',     // Step 4: pay, or continue in unpaid mode
  'done',
] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step)
}

// --- Section 6.2: post state machine ----------------------------------------
export const POST_STATUSES = [
  'draft',
  'pending_approval',
  'scheduled',
  'publishing',
  'published',
  'paused',
  'failed',
  'cancelled',
  'removed', // removed from the app only; still live on the platform
] as const
export type PostStatus = (typeof POST_STATUSES)[number]

/** Legal transitions. The server refuses anything not listed here. */
export const POST_TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  draft: ['pending_approval', 'scheduled', 'publishing', 'cancelled'],
  pending_approval: ['draft', 'scheduled', 'cancelled'],
  scheduled: ['paused', 'publishing', 'draft', 'cancelled'],
  publishing: ['published', 'failed'], // locked: no edit, drag, delete or pause
  published: ['removed'],
  paused: ['scheduled', 'draft', 'cancelled'],
  failed: ['scheduled', 'draft', 'cancelled'],
  cancelled: [],
  removed: [],
}

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return POST_TRANSITIONS[from].includes(to)
}

/** While publishing, the post is untouchable (Section 6.2). */
export const LOCKED_STATUSES: PostStatus[] = ['publishing']

// --- Section 6.1: connection health -----------------------------------------
export const CONNECTION_STATUSES = [
  'active',
  'needs_reconnect', // token refresh failed or access revoked
  'disconnected',
  'transferred',
] as const
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number]

// --- Section 6.3: roles ------------------------------------------------------
export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/** Higher wins. Used for "at least this role" checks. */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
}

export function atLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

// --- Section 7A: billing region ---------------------------------------------
export const BILLING_REGIONS = ['bd', 'global'] as const
export type BillingRegion = (typeof BILLING_REGIONS)[number]

export const REGION_CURRENCY: Record<BillingRegion, 'BDT' | 'USD'> = {
  bd: 'BDT',
  global: 'USD',
}

// --- Section 7.2 defaults ----------------------------------------------------
/** Days after due date before scheduled posts are paused (Section 7.2). */
export const PAYMENT_GRACE_DAYS = 3
/** Publish attempts before a target is marked failed (Section 4 flow). */
export const MAX_PUBLISH_ATTEMPTS = 3
/** Starter AI credits in unpaid mode so Step 3 works (Section 13, Q1 default). */
export const STARTER_AI_CREDITS = 50
/** Invite lifetime (Section 6.3). */
export const INVITE_EXPIRY_DAYS = 7
