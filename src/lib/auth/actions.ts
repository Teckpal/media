'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/env'
import { ROUTES } from '@/lib/routes'
import { getSessionUser } from '@/lib/auth/session'
import type { AuthFormState } from '@/lib/auth/form-state'
import { fieldErrorsFrom } from '@/lib/forms'
import { safeNext } from '@/lib/auth/safe-next'
import { createAdminClient } from '@/lib/supabase/admin'
import { openAccess } from '@/lib/billing/open-access'

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.')

const signUpSchema = z.object({
  fullName: z.string().trim().min(1, 'Tell us your name.').max(120),
  email: emailSchema,
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(200, 'That password is too long.'),
  // Section 7A.2: the country picked at signup is one input into the region
  // guess. It never decides the price — the payment method does.
  country: z.string().trim().length(2).toUpperCase().optional(),
})

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
})

/** Absolute URL for links Supabase emails out. */
async function absolute(path: string): Promise<string> {
  const host = (await headers()).get('host')
  const base =
    process.env.NODE_ENV === 'production' && host
      ? `https://${host}`
      : publicEnv().NEXT_PUBLIC_APP_URL
  return new URL(path, base).toString()
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    country: formData.get('country') || undefined,
  })

  if (!parsed.success) {
    return { error: 'Check the fields below.', fieldErrors: fieldErrorsFrom(parsed.error.issues) }
  }

  const supabase = await createClient()

  /**
   * The verification bypass has to go around `signUp`, not after it.
   *
   * MEASURED. Relaxing our own gate was not enough, and neither was marking
   * the address confirmed afterwards: with confirmations on, `signUp` tries to
   * send the mail itself, and Supabase's built-in mailer allows about two
   * messages an hour. The third signup of the hour failed with
   *
   *   "email rate limit exceeded"
   *
   * before any account existed at all. Nothing downstream can recover from
   * that, because there is nothing to recover.
   *
   * So under OPEN_ACCESS the account is created with the service role and
   * `email_confirm: true`. No mail is attempted, no rate limit applies, and a
   * session follows immediately from an ordinary password sign-in. Removing
   * the flag restores the real `signUp` path below with nothing else to undo —
   * and by then there will be an SMTP provider for it to use.
   */
  if (openAccess()) {
    const { error: createError } = await createAdminClient().auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        full_name: parsed.data.fullName,
        signup_country: parsed.data.country ?? null,
      },
    })

    // Deliberately the same sentence whether the address is taken or the call
    // failed for another reason. Telling a stranger which of their guesses
    // already has an account is the thing the normal path avoids too.
    if (createError) {
      return { error: 'That email could not be used. Try another, or sign in.' }
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })

    if (signInError) {
      // The account exists; only the session did not. Sending them to the
      // login form is honest and works.
      return { error: 'Your account is ready. Sign in to continue.' }
    }

    redirect(ROUTES.onboarding.chooseModule)
  }

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: await absolute(ROUTES.authConfirm),
      data: {
        full_name: parsed.data.fullName,
        signup_country: parsed.data.country ?? null,
      },
    },
  })

  if (error) {
    // Supabase does not distinguish "already registered" when confirmations are
    // on, and neither do we — saying so would confirm an address to a stranger.
    return { error: error.message }
  }

  // Section 5, rule 2: nothing else happens until the address is verified.
  redirect(ROUTES.verifyEmail)
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: 'Check the fields below.', fieldErrors: fieldErrorsFrom(parsed.error.issues) }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    return { error: 'That email and password do not match.' }
  }

  /**
   * Back to whatever they were trying to reach, if it was anywhere.
   *
   * An invitation link sends a signed-out visitor here with `?next=/invite/...`
   * — and this used to drop it, landing them on the dashboard with the
   * invitation unredeemed and no sign of what had happened. `safeNext` refuses
   * anything that is not a path on this site, because a login that forwards
   * wherever it is told is an open redirect.
   *
   * Section 4 still decides the rest: `/dashboard` is a request, not a
   * destination, and the gate on that route sends them to verification, the
   * saved onboarding step, or reconnect.
   */
  redirect(safeNext(formData.get('next'), ROUTES.dashboard))
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect(ROUTES.login)
}

export async function resendVerificationAction(): Promise<AuthFormState> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const supabase = await createClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: user.email,
    options: { emailRedirectTo: await absolute(ROUTES.authConfirm) },
  })

  if (error) return { error: error.message }
  return { error: null, notice: `Sent again to ${user.email}.` }
}
