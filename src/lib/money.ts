import type { CurrencyEnum } from '@/types/database'

/**
 * Money is stored and moved as integer minor units — poisha for BDT, cents for
 * USD. It becomes a decimal only here, on the way to a screen.
 */
export function formatMoney(minor: number, currency: CurrencyEnum, locale?: string): string {
  const resolvedLocale = locale ?? (currency === 'BDT' ? 'en-BD' : 'en-US')

  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)
}
