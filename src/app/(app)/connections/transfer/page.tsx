import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { TransferForm } from './transfer-form'
import { Alert } from '@/components/ui/alert'
import { requireWorkspace } from '@/lib/auth/gate'
import { availablePlatforms } from '@/lib/platforms'
import { atLeast } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Request an account transfer' }

/**
 * Section 6.1, the locked-out owner: an old agency still holds the Page, or a
 * client has left MOTiF and signed up on their own.
 *
 * This opens a case and nothing more. The decision rests on a platform-side
 * admin check by support, and the requester is never told which workspace holds
 * the account — the page cannot say, because the column is revoked from client
 * reads in migration 0008.
 */
export default async function TransferPage() {
  const { active } = await requireWorkspace()

  if (!atLeast(active.role, 'admin')) {
    redirect(`${ROUTES.connections}?error=forbidden`)
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Request an account transfer
        </h1>
        <p className="text-sm text-muted-foreground">
          For when an account that belongs to you is connected somewhere else.
        </p>
      </div>

      <Alert title="How this works">
        Support confirms ownership with the platform directly, not from what is
        written here. If it checks out, the account is moved, whoever holds it is
        told, and anything they had scheduled for it is cancelled.
      </Alert>

      <TransferForm platforms={availablePlatforms()} />
    </div>
  )
}
