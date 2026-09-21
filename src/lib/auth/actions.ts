'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/env'
import { ROUTES } from '@/lib/routes'
import { getSessionUser } from '@/lib/auth/session'
import type { AuthFormState } from '@/lib/auth/form-state'

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

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    out[key] ??= issue.message
  }
  return out
}

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
    return { error: 'Check the fields below.', fieldErrors: fieldErrorsOf(parsed.error) }
  }

  const supabase = await createClient()
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
    return { error: 'Check the fields below.', fieldErrors: fieldErrorsOf(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    return { error: 'That email and password do not match.' }
  }

  // Section 4: the router decides where a signed-in user actually lands.
  // `/dashboard` is a request, not a destination — the gate on that route
  // sends them to verification, the saved onboarding step, or reconnect.
  redirect(ROUTES.dashboard)
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
