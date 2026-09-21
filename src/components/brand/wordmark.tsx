import { cn } from '@/lib/utils'

/**
 * Working name is "motif Social" (Section 12). Kept in one component so the
 * rename to Postiyon or Dakpiyon, once trademark clearance is done, is a
 * one-file change.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-lg font-semibold tracking-tight', className)}>
      motif<span className="text-primary"> Social</span>
    </span>
  )
}
