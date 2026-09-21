import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm',
        'text-foreground placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-55',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  )
}
