import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adapterFor, isSupported } from '@/lib/platforms'
import { consumeOAuth } from '@/lib/platforms/oauth-state'
import { redirectUriFor } from '@/lib/platforms/redirect'
import { ConnectError, type ConnectFailure } from '@/lib/platforms/types'
import { encryptToken } from '@/lib/crypto/tokens'
import { ROUTES } from '@/lib/routes'

/** How long the user has to choose which pages to connect. */
const SELECTION_WINDOW_MS = 15 * 60 * 1000

/**
 * Where OAuth comes back to.
 *
 * Every exit from here is a redirect carrying one of Section 6.1's named
 * failures, so each case gets the screen the note asks for instead of a stack
 * trace. Nothing is connected yet — the user still has to choose, because
 * Section 7.1 bills per connected account and silently claiming every page they
 * administer would charge them for pages they never asked for.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { origin, searchParams } = new URL(request.url)
  const { platform } = await params

  if (!isSupported(platform)) {
    return fail(origin, ROUTES.connections, 'provider_error')
  }

  // Consumed first, and unconditionally: a state is single-use, so a replayed
  // callback finds nothing waiting for it.
  const state = await consumeOAuth(searchParams.get('state'), platform)
  if (!state) {
    return fail(origin, ROUTES.connections, 'invalid_state')
  }

  // Meta sends error=access_denied when the user backs out of the dialog.
  if (searchParams.get('error')) {
    return fail(origin, state.returnTo, 'cancelled')
  }

  const code = searchParams.get('code')
  if (!code) {
    return fail(origin, state.returnTo, 'cancelled')
  }

  const adapter = adapterFor(platform)
  if (!adapter) {
    return fail(origin, state.returnTo, 'provider_error')
  }

  try {
    const token = await adapter.exchangeCode(code, redirectUriFor(platform, origin))

    // Throws 'missing_permissions' on a partial grant and 'wrong_account_type'
    // when there is nothing publishable behind the account. Called here, before
    // anything is written, so a doomed connection never reaches the database.
    const discovered = await adapter.listAccounts(token)

    // The service role, deliberately: oauth_sessions has no RLS policy at all,
    // because this row holds a live platform token and should be unreachable
    // from a browser even by the person it belongs to.
    const admin = createAdminClient()
    const { data: session, error } = await admin
      .from('oauth_sessions')
      .insert({
        user_id: state.userId,
        workspace_id: state.workspaceId,
        platform,
        access_token_encrypted: encryptToken(token.accessToken, 'oauth_session:v1'),
        refresh_token_encrypted: token.refreshToken
          ? encryptToken(token.refreshToken, 'oauth_session:v1')
          : null,
        token_expires_at: token.expiresAt?.toISOString() ?? null,
        granted_scopes: token.scopes,
        expires_at: new Date(Date.now() + SELECTION_WINDOW_MS).toISOString(),
      })
      .select('id')
      .single()

    if (error || !session) {
      return fail(origin, state.returnTo, 'provider_error')
    }

    await admin.from('audit_log').insert({
      workspace_id: state.workspaceId,
      actor_id: state.userId,
      action: 'connection.oauth_completed',
      entity_type: 'oauth_session',
      entity_id: session.id,
      source: 'web',
      detail: { platform, discovered: discovered.length },
    })

    return NextResponse.redirect(
      `${origin}${ROUTES.connectSelect}?session=${session.id}`,
    )
  } catch (cause) {
    const failure: ConnectFailure =
      cause instanceof ConnectError ? cause.failure : 'provider_error'

    // The provider's own message stays in the log. The user gets the wording
    // Section 6.1 specifies, which for a blocked account names no workspace
    // and no owner.
    console.error('[connect] %s failed: %s', platform, describe(cause))

    return fail(origin, state.returnTo, failure)
  }
}

function fail(origin: string, returnTo: string, failure: ConnectFailure) {
  return NextResponse.redirect(`${origin}${returnTo}?error=${failure}`)
}

function describe(cause: unknown): string {
  if (cause instanceof ConnectError) return `${cause.failure}: ${cause.detail ?? cause.message}`
  return cause instanceof Error ? cause.message : String(cause)
}
