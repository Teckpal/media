import Link from 'next/link'
import { Wordmark } from '@/components/brand/wordmark'
import { ROUTES } from '@/lib/routes'

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="motif-product flex min-h-dvh flex-col">
      <header className="px-4 py-5 sm:px-8">
        <Link href={ROUTES.home} className="inline-block">
          <Wordmark />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:px-8">
        {/* The white card the palette asks for. Here rather than in each page,
            so sign-in, sign-up and verification are one shape — they are the
            same moment in the same flow and should not each be a different
            box. */}
        <div className="w-full max-w-sm rounded-[var(--radius)] border border-border bg-surface p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
