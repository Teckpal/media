import { createAdminClient } from '@/lib/supabase/admin'
import { gatewayById } from '@/lib/billing/gateways'
import { settlePayment } from '@/lib/billing/activation'
import type { PaymentGatewayEnum } from '@/types/database'

/**
 * The server-to-server callback. Section 7.2: this, plus the gateway's own
 * validation API, is the only thing trusted to mark an invoice paid.
 *
 * Three habits make it safe to be a public endpoint:
 *
 * 1. **Write the event before acting on it.** `gateway_events` has a unique
 *    `(gateway, event_id)`, so a replayed callback collides and is recognised
 *    rather than processed twice. It also leaves a record when a gateway later
 *    disputes what it sent.
 * 2. **Believe nothing in the body.** The body says which transaction to ask
 *    about. What happened to it is decided by calling the gateway back.
 * 3. **Answer 200 to anything we understood.** A gateway retries on an error
 *    status, so returning 500 because a payment failed would have it retrying
 *    a genuine failure for hours.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/webhooks/[gateway]/ipn'>) {
  const { gateway: gatewayId } = await ctx.params

  const gateway = gatewayById(gatewayId as PaymentGatewayEnum)
  if (!gateway) {
    return new Response('Unknown gateway', { status: 404 })
  }

  let fields: Record<string, string>
  try {
    const form = await request.formData()
    fields = Object.fromEntries(
      [...form.entries()].map(([key, value]) => [key, String(value)]),
    )
  } catch {
    return new Response('Unreadable body', { status: 400 })
  }

  const claim = gateway.readCallback(fields)
  if (!claim) {
    // Understood the request, found nothing to do with it. 200 so it is not
    // retried for ever.
    return Response.json({ ok: true, ignored: true })
  }

  const admin = createAdminClient()

  const { error: logError } = await admin.from('gateway_events').insert({
    gateway: gateway.id,
    event_id: claim.eventId,
    event_type: claim.eventType,
    signature_verified: claim.signatureVerified,
    payload: fields,
  })

  if (logError) {
    // The unique index did its job: this exact event has been here before.
    // Answering ok is right — the first delivery either settled it or recorded
    // why it could not.
    return Response.json({ ok: true, duplicate: true })
  }

  // A body that carries a signature and gets it wrong is not a body to act on,
  // even though validation would catch it a moment later. A body with no
  // signature at all is allowed through to validation, because that is what
  // decides anyway and some sandbox configurations do not sign.
  if (fields.verify_sign && !claim.signatureVerified) {
    await admin
      .from('gateway_events')
      .update({
        processed_at: new Date().toISOString(),
        processing_error: 'signature did not verify',
      })
      .eq('gateway', gateway.id)
      .eq('event_id', claim.eventId)

    console.error('[billing] rejected %s callback with a bad signature', gateway.id)
    return Response.json({ ok: true, rejected: true })
  }

  const result = await settlePayment({
    gateway: gateway.id,
    transactionId: claim.transactionId,
    reference: claim.reference,
  })

  await admin
    .from('gateway_events')
    .update({
      processed_at: new Date().toISOString(),
      processing_error:
        result.kind === 'failed' || result.kind === 'unknown' ? result.kind : null,
    })
    .eq('gateway', gateway.id)
    .eq('event_id', claim.eventId)

  return Response.json({ ok: true, outcome: result.kind })
}
