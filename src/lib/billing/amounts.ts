// Pure. Relative imports so the test runner can load it directly.

/**
 * The border between our money and a gateway's.
 *
 * Everything inside the app is an integer of minor units. Every gateway speaks
 * decimal strings — `"499.00"` — and the conversion is where a rounding error
 * turns into a payment that does not match its invoice and an activation that
 * silently does not happen.
 *
 * So it is done by string arithmetic, never by `parseFloat`. `parseFloat`
 * would be right almost always, and the exceptions would be rare, real and
 * very hard to find in a log.
 */

/** `49900` -> `"499.00"`, ready to send to a gateway. */
export function minorToDecimalString(minor: number): string {
  const negative = minor < 0
  const digits = Math.abs(Math.trunc(minor)).toString().padStart(3, '0')

  const whole = digits.slice(0, -2)
  const fraction = digits.slice(-2)

  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/**
 * `"499.00"` -> `49900`, or null when the string is not a plain decimal
 * amount.
 *
 * Null rather than a guess: an amount that cannot be read is an amount that
 * must not be compared against an invoice, and the caller is expected to
 * refuse the payment rather than assume.
 */
export function decimalToMinor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null

  const text = String(value).trim()
  if (text === '') return null

  // Optional sign, digits, optionally a decimal point and one or two digits.
  // Anything else — scientific notation, thousands separators, a currency
  // symbol — is refused rather than interpreted.
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return null

  const [, sign, whole, fraction = ''] = match
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(minor)) return null

  return sign ? -minor : minor
}

/**
 * Do two amounts agree?
 *
 * Exact equality, on purpose. A gateway that settles a different amount from
 * the one on the invoice has not paid that invoice, and "close enough" is how
 * a discounted or tampered payment activates a full subscription.
 */
export function amountsMatch(
  invoiceMinor: number,
  gatewayAmount: string | number | null | undefined,
): boolean {
  const paid = decimalToMinor(gatewayAmount)
  return paid !== null && paid === invoiceMinor
}
