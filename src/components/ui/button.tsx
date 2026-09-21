import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary-hover disabled:hover:bg-primary',
  secondary:
    'bg-surface text-foreground border border-border hover:bg-surface-muted',
  ghost: 'text-foreground hover:bg-surface-muted',
  danger: 'bg-danger text-danger-foreground hover:opacity-90',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
}

export type ButtonStyleProps = {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  className?: string
}

/**
 * The button look, without the element.
 *
 * A link that navigates should stay an `<a>` — it belongs in the tab order as a
 * link, opens in a new tab on middle click, and is announced as a link. So it
 * borrows these classes rather than being wrapped in a `<button>`.
 */
export function buttonStyles({
  variant = 'primary',
  size = 'md',
  fullWidth,
  className,
}: ButtonStyleProps = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium',
    'transition-colors disabled:cursor-not-allowed disabled:opacity-55',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    className,
  )
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleProps

export function Button({ variant, size, fullWidth, className, ...props }: Props) {
  return (
    <button className={buttonStyles({ variant, size, fullWidth, className })} {...props} />
  )
}
