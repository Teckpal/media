import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/auth/session'
import { adapterFor, isSupported } from '@/lib/platforms'
import { beginOAuth } from '@/lib/platforms/oauth-state'
import { ROUTES } from '@/lib/routes'
import { redirectUriFor } from '@/lib/platforms/redirect'

/**
 * Starts an OAuth connection.
 *
 * Section 5, rule 2: the email must already be verified, and that is checked
 * here rather than trusted from the screen the link was on.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { origin } = new URL(request.url)
  const { platform } = await params

  const user = await getSessionUser()
  if (!user) return NextResponse.redirect(`${origin}${ROUTES.login}`)
  if (!user.emailVerified) return NextResponse.redirect(`${origin}${ROUTES.verifyEmail}`)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) return NextResponse.redirect(`${origin}${ROUTES.onboarding.setup}`)

  // Section 6.3: connecting an account is an admin action.
  const supabase = await createClient()
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.redirect(`${origin}${ROUTES.connections}?error=forbidden`)
  }

  if (!isSupported(platform)) {
    return NextResponse.redirect(`${origin}${ROUTES.connections}?error=unsupported`)
  }

  const adapter = adapterFor(platform)
  if (!adapter) {
    return NextResponse.redirect(`${origin}${ROUTES.connections}?error=unsupported`)
  }

  // Onboarding sends people back to onboarding; everyone else to Connections.
  const returnTo =
    user.profile.onboarding_step === 'connect'
      ? ROUTES.onboarding.connect
      : ROUTES.connections

  const nonce = await beginOAuth({
    platform,
    workspaceId,
    userId: user.id,
    returnTo,
  })

  try {
    const url = adapter.buildAuthUrl({
      redirectUri: redirectUriFor(platform, origin),
      state: nonce,
    })
    return NextResponse.redirect(url)
  } catch {
    // The adapter throws when the platform has no app credentials configured.
    return NextResponse.redirect(`${origin}${returnTo}?error=provider_error`)
  }
}
