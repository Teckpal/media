import { deleteForPlatformUser, readSignedRequest } from '@/lib/privacy/deletion'
import { appUrl } from '@/lib/env'

/**
 * Meta's data deletion callback.
 *
 * Meta POSTs a form-encoded `signed_request` when somebody removes the app
 * from their Facebook account, and expects JSON back naming a page they can
 * visit and a code they can quote. Both are required before Meta will review
 * an app for the permissions Module 4 needs (Section 11, Phase 0).
 *
 * It is unauthenticated by design — there is no session, because the person
 * making the request is doing it on Facebook, not here. The signature IS the
 * authentication, so a request that does not verify gets 400 and nothing is
 * touched.
 */
export async function POST(request: Request) {
  let signed: string | null = null

  // Meta sends this form-encoded. Accepting JSON too costs nothing and saves
  // an afternoon when somebody tests it with curl.
  const contentType = request.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { signed_request?: string }
      signed = body.signed_request ?? null
    } else {
      const form = await request.formData()
      signed = String(form.get('signed_request') ?? '') || null
    }
  } catch {
    signed = null
  }

  if (!signed) {
    return Response.json({ error: 'signed_request is required' }, { status: 400 })
  }

  const verified = readSignedRequest(signed)
  if (!verified) {
    // Deliberately unspecific. Telling a forger which half of the check failed
    // is help they have not earned.
    return Response.json({ error: 'signed_request could not be verified' }, { status: 400 })
  }

  const outcome = await deleteForPlatformUser('facebook', verified.userId)

  // The exact shape Meta expects: where to look, and what to quote.
  return Response.json({
    url: `${appUrl()}/data-deletion/${outcome.confirmationCode}`,
    confirmation_code: outcome.confirmationCode,
  })
}

/**
 * A GET here is somebody pasting the callback URL into a browser to see what
 * it is. Say so, rather than returning a 405 that reads like a fault.
 */
export function GET() {
  return Response.json(
    {
      message:
        'This endpoint receives data deletion callbacks from Meta. To request deletion yourself, see /legal/data-deletion.',
    },
    { status: 200 },
  )
}
