// Pure. No network, no database, no environment — the app URL is passed in.

/**
 * The email a notification becomes.
 *
 * Two things here are security rather than presentation, and both are tested:
 *
 * 1. **Everything interpolated is escaped.** A notification body carries a post
 *    caption, an account name and a gateway's error message — all of them text
 *    somebody else wrote. Dropped into HTML unescaped, a caption containing
 *    `<script>` or a broken-out attribute is an injection into a mail client.
 * 2. **Only internal links are linked.** `link_path` is written by our own code
 *    today, but a notification is a row in a table and rows outlive the
 *    assumptions of the code that wrote them. A path that is not a plain
 *    single-slash internal one is dropped rather than rendered, so this can
 *    never become a way to put an attacker's URL behind our own from-address.
 */

export type EmailContent = {
  subject: string
  text: string
  html: string
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char])
}

/**
 * Is this a path we are willing to put behind a link?
 *
 * A single leading slash and no second one, so `//evil.example` — which a
 * browser reads as protocol-relative and sends off-site — is refused along with
 * `https://…` and `javascript:…`.
 */
export function isInternalPath(path: string | null | undefined): path is string {
  if (!path) return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  // A backslash is treated as a slash by some clients, so `/\evil.example`
  // would escape too.
  if (path.includes('\\')) return false
  return true
}

export function absoluteLink(appUrl: string, path: string | null | undefined): string | null {
  if (!isInternalPath(path)) return null
  return `${appUrl.replace(/\/$/, '')}${path}`
}

export type EmailInput = {
  title: string
  body?: string | null
  linkPath?: string | null
  appUrl: string
  workspaceName?: string | null
  /** The call to action. Defaults to something honest and dull. */
  linkLabel?: string
}

export function renderNotificationEmail(input: EmailInput): EmailContent {
  const link = absoluteLink(input.appUrl, input.linkPath)
  const linkLabel = input.linkLabel ?? 'Open motif Social'
  const body = (input.body ?? '').trim()

  // The workspace is in the subject because a person may run several — an
  // agency on the Self module has one per client brand (Section 3) — and "A
  // post did not go out" tells them nothing on its own.
  const subject = input.workspaceName
    ? `${input.title} · ${input.workspaceName}`
    : input.title

  const textParts = [input.title]
  if (body) textParts.push('', body)
  if (link) textParts.push('', `${linkLabel}: ${link}`)
  textParts.push('', '—', 'motif Social')

  const htmlParts = [
    '<!doctype html>',
    '<html lang="en">',
    '<body style="margin:0;padding:24px;background:#f6f6f7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">',
    `<h1 style="margin:0 0 12px;font-size:18px;line-height:1.4;">${escapeHtml(input.title)}</h1>`,
  ]

  if (body) {
    htmlParts.push(
      `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(
        body,
      )}</p>`,
    )
  }

  if (link) {
    htmlParts.push(
      `<a href="${escapeHtml(link)}" style="display:inline-block;background:#18181b;color:#ffffff;` +
        `text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;">` +
        `${escapeHtml(linkLabel)}</a>`,
    )
  }

  htmlParts.push(
    '<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#71717a;">',
    'You are receiving this because you are a member of ',
    input.workspaceName ? escapeHtml(input.workspaceName) : 'a motif Social workspace',
    '. You can turn these emails off in Settings.',
    '</p>',
    '</div>',
    '</body>',
    '</html>',
  )

  return {
    subject,
    text: textParts.join('\n'),
    html: htmlParts.join(''),
  }
}
