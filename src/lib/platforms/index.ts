import 'server-only'

import { facebookAdapter, instagramAdapter } from '@/lib/platforms/meta'
import { linkedinAdapter } from '@/lib/platforms/linkedin'
import { tiktokAdapter } from '@/lib/platforms/tiktok'
import { xAdapter } from '@/lib/platforms/x'
import { youtubeAdapter } from '@/lib/platforms/youtube'
import type { PlatformAdapter } from '@/lib/platforms/types'
import { PLATFORMS, type Platform } from '@/lib/constants'

/**
 * The platforms that are wired.
 *
 * All six have an adapter now. An adapter existing is not the same as a
 * platform working: each refuses to build an auth URL while its credentials
 * are unset, so an unconfigured platform is offered as "needs setup" rather
 * than as a button that fails after the user has clicked through a consent
 * screen. `configuredPlatforms()` is what the connect screen should ask.
 */
const ADAPTERS: Partial<Record<Platform, PlatformAdapter>> = {
  facebook: facebookAdapter,
  instagram: instagramAdapter,
  twitter: xAdapter,
  linkedin: linkedinAdapter,
  tiktok: tiktokAdapter,
  youtube: youtubeAdapter,
}

export function adapterFor(platform: Platform): PlatformAdapter | null {
  return ADAPTERS[platform] ?? null
}

export function isSupported(value: string): value is Platform {
  return value in ADAPTERS
}

/** Every platform with an adapter, configured or not. */
export function availablePlatforms(): Platform[] {
  return PLATFORMS.filter((p) => p in ADAPTERS)
}

/**
 * Can this platform actually be connected right now?
 *
 * Each adapter throws `ConnectError('provider_error')` from `buildAuthUrl`
 * when its credentials are missing, so asking it to build one is the honest
 * test — there is no second list of required variables to drift out of step
 * with the adapters themselves.
 */
export function isConfigured(platform: Platform): boolean {
  const adapter = ADAPTERS[platform]
  if (!adapter) return false

  try {
    adapter.buildAuthUrl({
      redirectUri: 'https://example.invalid/probe',
      state: 'probe',
      codeChallenge: adapter.usesPkce ? 'probe' : undefined,
    })
    return true
  } catch {
    return false
  }
}

/** The ones a visitor can connect today. */
export function configuredPlatforms(): Platform[] {
  return availablePlatforms().filter(isConfigured)
}
