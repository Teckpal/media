import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-[var(--radius)] border border-border bg-surface px-3 text-sm',
        'text-foreground disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    />
  )
}
