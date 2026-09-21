import Link from 'next/link'
import { Wordmark } from '@/components/brand/wordmark'
import { ROUTES } from '@/lib/routes'

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 py-5 sm:px-8">
        <Link href={ROUTES.home} className="inline-block">
          <Wordmark />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
