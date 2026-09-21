import 'server-only'

import { facebookAdapter, instagramAdapter } from '@/lib/platforms/meta'
import type { PlatformAdapter } from '@/lib/platforms/types'
import { PHASE_1_PLATFORMS, type Platform } from '@/lib/constants'

/**
 * The platforms that are actually wired.
 *
 * Section 11 phases the other four in: LinkedIn and YouTube in Phase 2, TikTok
 * and X in Phase 3. Until an adapter exists here, the connect screen offers the
 * platform nowhere and the routes refuse it — rather than half-working.
 */
const ADAPTERS: Partial<Record<Platform, PlatformAdapter>> = {
  facebook: facebookAdapter,
  instagram: instagramAdapter,
}

export function adapterFor(platform: Platform): PlatformAdapter | null {
  return ADAPTERS[platform] ?? null
}

export function isSupported(value: string): value is Platform {
  return value in ADAPTERS
}

/** What the connect screen should offer today. */
export function availablePlatforms(): Platform[] {
  return PHASE_1_PLATFORMS.filter((p) => p in ADAPTERS)
}
