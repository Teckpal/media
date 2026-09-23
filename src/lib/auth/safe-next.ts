/**
 * Where a sign-in may send somebody afterwards.
 *
 * `next` arrives in the query string, which means an attacker chooses it. A
 * login that forwards to whatever it is handed is an open redirect: a link on
 * OUR domain, carrying our branding and our padlock, that lands on theirs —
 * and the victim has just typed a password, which is exactly the frame of mind
 * a phishing page wants them in.
 *
 * The rule is allow-list shaped rather than deny-list shaped: one leading
 * slash, no scheme, no host, no backslash, no control characters. Anything
 * else falls back to the dashboard, where the router gate decides properly.
 */
export function safeNext(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback

  // Must be a path on this site.
  if (!value.startsWith('/')) return fallback

  // `//evil.example` is protocol-relative: it begins with a slash and is still
  // another host. The one people miss.
  if (value.startsWith('//')) return fallback

  // A backslash anywhere. Browsers normalise it to a forward slash in some
  // positions, so `/\evil.example` becomes `//evil.example` — and reasoning
  // about which positions is a losing game.
  if (value.includes('\\')) return fallback

  // `/https:/evil.example` and `/javascript:alert(1)` both survive the checks
  // above; a scheme after the slash does not belong in a path.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return fallback

  // Control characters, including the newline that splits a header.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback

  return value
}
