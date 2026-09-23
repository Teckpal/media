import {
  Link2,
  LogIn,
  Mail,
  Send,
  ShieldCheck,
  Trash2,
  UserMinus,
  type LucideIcon,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatDateTimeInZone } from '@/lib/time'

/**
 * What the team has been doing.
 *
 * Section 6.3 splits work across people, and Section 6.2 keeps removed posts
 * in the audit log — but until now nothing read it back, so "who disconnected
 * that account" was a question only the database could answer. This is that
 * answer, on the page where the people are.
 *
 * Admins only, and not because the page hides it: `audit_log_select_admin`
 * (migration 0008) is the only SELECT policy on the table, so an editor asking
 * for these rows gets none. The gate is in the database; this component simply
 * is not rendered when there is nothing to show.
 *
 * Actions are described rather than printed. `member.role_changed` means
 * nothing to somebody who did not write it, and a table of dotted identifiers
 * is a log, not a record of what the team did.
 */

export type ActivityEntry = {
  id: number
  action: string
  actorName: string | null
  actorEmail: string | null
  entityType: string | null
  entityId: string | null
  source: string
  detail: Record<string, unknown>
  createdAt: string
}

export function ActivityTable({
  entries,
  timeZone,
  unreadable = false,
}: {
  entries: ActivityEntry[]
  timeZone: string
  /** The query failed. Distinct from "nothing has happened", which it resembles. */
  unreadable?: boolean
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-medium tracking-tight">Activity</h2>
        <p className="text-sm text-muted-foreground">
          Everything that changed this workspace, and who changed it. Admins and
          owners only.
        </p>
      </div>

      {unreadable ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            The activity log could not be read just now. It has not been lost —
            refresh in a moment.
          </p>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet. Invitations, role changes, disconnected
            accounts and removed posts land here.
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
          {/* A table on a screen wide enough for one, and the same rows stacked
              on a phone. A five-column table at 360px is unreadable whatever
              the horizontal scrollbar allows. */}
          <table className="w-full border-collapse text-sm">
            <thead className="sr-only sm:not-sr-only">
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  What happened
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Who
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  When
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {entries.map((entry) => {
                const { icon: Icon, text } = describe(entry)

                return (
                  <tr key={entry.id} className="block sm:table-row">
                    <td className="block px-4 pt-3 pb-1 sm:table-cell sm:py-3">
                      <span className="flex items-start gap-2.5">
                        <Icon
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="text-pretty">{text}</span>
                      </span>
                    </td>

                    <td className="block px-4 py-0.5 text-muted-foreground sm:table-cell sm:py-3 sm:whitespace-nowrap">
                      {entry.source === 'system' ? (
                        <span className="italic">motif Social</span>
                      ) : (
                        (entry.actorName ?? entry.actorEmail ?? 'Someone who has left')
                      )}
                      {entry.source === 'whatsapp' ? (
                        <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px]">
                          WhatsApp
                        </span>
                      ) : null}
                    </td>

                    <td className="block px-4 pt-0.5 pb-3 text-xs text-muted-foreground sm:table-cell sm:py-3 sm:text-sm sm:whitespace-nowrap">
                      {formatDateTimeInZone(entry.createdAt, timeZone)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * One audit row, as a sentence.
 *
 * The fallback matters more than the cases: actions are written by code all
 * over the app, and one added next week must still produce a readable row
 * rather than a blank cell. So an unknown action is tidied into words instead
 * of dropped.
 */
function describe(entry: ActivityEntry): { icon: LucideIcon; text: string } {
  const detail = entry.detail ?? {}
  const email = typeof detail.email === 'string' ? detail.email : null
  const role = typeof detail.role === 'string' ? detail.role : null
  const from = typeof detail.from === 'string' ? detail.from : null
  const to = typeof detail.to === 'string' ? detail.to : null

  switch (entry.action) {
    case 'member.invited':
      return {
        icon: Mail,
        text: `Invited ${email ?? 'someone'}${role ? ` as ${role}` : ''}`,
      }

    case 'invite.revoked':
      return { icon: Trash2, text: 'Revoked an invitation' }

    case 'member.joined':
      return { icon: LogIn, text: `Joined the workspace${role ? ` as ${role}` : ''}` }

    case 'member.role_changed':
      return {
        icon: ShieldCheck,
        text: from && to ? `Changed a role from ${from} to ${to}` : 'Changed a role',
      }

    case 'member.removed':
      return {
        icon: UserMinus,
        text: `Removed a member${role ? ` who was ${role}` : ''} from the workspace`,
      }

    case 'account.connected':
      return { icon: Link2, text: 'Connected an account' }

    case 'account.disconnected':
      return { icon: Link2, text: 'Disconnected an account' }

    case 'connection.deleted_by_request':
      return {
        icon: Link2,
        text: `An account was disconnected at ${
          typeof detail.platform === 'string' ? labelFor(detail.platform) : 'the platform'
        }'s request, after someone asked for their data to be deleted`,
      }

    case 'post.removed':
      return {
        icon: Trash2,
        text: 'Removed a post from motif Social (it is still live on the platform)',
      }

    case 'post.published':
      return { icon: Send, text: 'Published a post' }

    default:
      return { icon: Send, text: humanise(entry.action) }
  }
}

/** `meta` -> `Meta`. Enough for a sentence; the connections page has the rest. */
function labelFor(platform: string): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

/** `transfer.approved` -> `Transfer approved`. */
function humanise(action: string): string {
  const words = action.replace(/[._]/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
