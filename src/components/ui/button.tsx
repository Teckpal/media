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
  /**
   * Outlined, not filled.
   *
   * The product's accent and its error colour are the same red, which is what
   * the design asks for — and a filled destructive button would then be pixel
   * for pixel a primary one. "Disconnect" and "Save" must not look alike; the
   * label is not enough when the shape and the colour already agree.
   *
   * Outlining also puts the weight where it belongs. A destructive action is
   * not the thing on a screen that should draw the eye first.
   */
  danger: 'bg-surface text-danger border border-danger/40 hover:bg-danger-subtle',
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
