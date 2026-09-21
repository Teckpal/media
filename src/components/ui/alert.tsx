import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'info' | 'success' | 'warning' | 'danger'

const TONES: Record<Tone, string> = {
  info: 'bg-surface-muted text-foreground border-border',
  success: 'bg-success-subtle text-foreground border-success/40',
  warning: 'bg-warning-subtle text-foreground border-warning/40',
  danger: 'bg-danger-subtle text-foreground border-danger/40',
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone
  title?: string
  children?: ReactNode
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-[var(--radius)] border px-3.5 py-3 text-sm', TONES[tone])}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
    </div>
  )
}
