import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-[var(--radius)] border border-border bg-surface px-3 text-sm',
        'text-foreground placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-55',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  )
}
