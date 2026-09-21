import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Card({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border border-border bg-surface p-6',
        className,
      )}
    >
      {children}
    </div>
  )
}
