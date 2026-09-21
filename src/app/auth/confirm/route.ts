import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/routes'

/**
 * The link in the verification email lands here.
 *
 * On success the user's onboarding advances past `verify_email` and they are
 * handed to the router gate, which decides where they actually belong
 * (Section 4). On failure they go back to the verify screen with a reason,
 * never to the dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}${ROUTES.verifyEmail}?error=invalid_link`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error) {
    return NextResponse.redirect(`${origin}${ROUTES.verifyEmail}?error=expired`)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('onboarding_step, signup_country')
      .eq('id', user.id)
      .maybeSingle()

    // Only ever move forward. A user who clicks an old verification link after
    // finishing onboarding must not be dragged back to step one.
    if (profile?.onboarding_step === 'verify_email') {
      await supabase
        .from('users')
        .update({
          onboarding_step: 'choose_module',
          // Carried from signup metadata; one of the three region inputs in
          // Section 7A.2, and never the deciding one.
          signup_country:
            profile.signup_country ??
            (user.user_metadata?.signup_country as string | null) ??
            null,
        })
        .eq('id', user.id)
    }
  }

  return NextResponse.redirect(`${origin}${ROUTES.dashboard}`)
}
