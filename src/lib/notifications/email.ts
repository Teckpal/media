import 'server-only'

import { serverEnv } from '@/lib/env'
import type { EmailContent } from '@/lib/notifications/templates'

/**
 * Email, through Resend's HTTP API.
 *
 * No SDK: it is one POST with a bearer token, and a dependency that wraps that
 * is a dependency to keep current for no gain. The same reasoning as the Meta
 * client in `platforms/meta.ts`.
 *
 * One request per recipient, never one request with several addresses in `to`.
 * A workspace's members would otherwise see each other's email addresses in the
 * header of every notification — which is a privacy leak nobody asked for and
 * nobody would notice until a customer did.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const TIMEOUT_MS = 15_000

export type SendOutcome =
  | { ok: true; providerId: string | null }
  | { ok: false; retryable: boolean; error: string }

export function emailConfigured(): boolean {
  return Boolean(serverEnv().RESEND_API_KEY)
}

export async function sendEmail(params: {
  to: string
  content: EmailContent
}): Promise<SendOutcome> {
  const env = serverEnv()

  if (!env.RESEND_API_KEY) {
    return { ok: false, retryable: false, error: 'No email provider is configured.' }
  }

  let response: Response
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [params.to],
        subject: params.content.subject,
        html: params.content.html,
        text: params.content.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    // Unreachable. Worth another go — unlike a refusal, which will be refused
    // again just as firmly.
    return { ok: false, retryable: true, error: `Could not reach the mail provider: ${String(cause)}` }
  }

  const body = (await response.json().catch(() => ({}))) as {
    id?: string
    message?: string
    name?: string
  }

  if (response.ok) {
    return { ok: true, providerId: body.id ?? null }
  }

  // 429 and 5xx are the provider's problem and pass. A 4xx is ours — an
  // unverified sending domain, a malformed address — and retrying it three
  // more times just delays the moment somebody notices.
  const retryable = response.status === 429 || response.status >= 500

  return {
    ok: false,
    retryable,
    error: `${response.status} ${body.name ?? ''} ${body.message ?? ''}`.trim(),
  }
}
