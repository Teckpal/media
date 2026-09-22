import type { Metadata } from 'next'
import Link from 'next/link'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms on which motif Social is provided.',
  alternates: { canonical: '/legal/terms' },
}

/**
 * The other URL Meta asks for before it will review an app, and the one a
 * customer looks for before they put a card in.
 *
 * Written to match what the product actually does — the grace period, what
 * happens to data when a plan lapses, who may publish — so that the terms and
 * the software cannot quietly disagree.
 */
export default function TermsPage() {
  return (
    <article className="mx-auto w-full max-w-2xl space-y-8 px-4 py-16 sm:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Terms</h1>
        <p className="text-sm text-muted-foreground">
          The short version: we publish what you schedule, you pay for the
          accounts you connect, and your work stays yours.
        </p>
      </header>

      <Alert tone="warning" title="Not yet reviewed by a lawyer">
        These describe how the service behaves today. They need review — and a
        registered company name and address — before anyone is charged.
      </Alert>

      <Section title="What the service does">
        <p>
          motif Social schedules and publishes posts to social accounts you
          connect, currently Facebook Pages and Instagram business accounts. We
          publish through those platforms&rsquo; own interfaces and are bound by
          their rules; if a platform refuses a post, we tell you why.
        </p>
      </Section>

      <Section title="Your account and your accounts">
        <p>
          You must be entitled to publish to any social account you connect. An
          account can be connected to one workspace at a time; if it is already
          somewhere else, you can open a transfer request and we will look at
          it — we will never tell you who currently holds it.
        </p>
        <p>
          Roles decide what each member can do. Owners handle billing, admins
          run the workspace, editors write and schedule, viewers read.
        </p>
      </Section>

      <Section title="Paying">
        <p>
          The subscription is priced per connected social account, per month.
          Prices depend on your billing region, which is settled by the payment
          method you first use and fixed after that; changing it is a support
          request at renewal.
        </p>
        <p>
          There is no free tier for publishing and no trial. You can use the
          product without paying — write drafts, connect accounts, plan a
          calendar — but scheduling and publishing need an active plan.
        </p>
        <p>
          If a payment is late, publishing continues for three days past the due
          date. After that, scheduled posts are paused and publishing is locked.
          Nothing is deleted: your drafts, media, calendar and connections stay
          exactly as they were, and paying resumes them.
        </p>
        <p>
          A downgrade becomes credit against your next invoice rather than a
          refund.
        </p>
      </Section>

      <Section title="What we will not do">
        <p>
          We will not publish anything nobody scheduled, and we will not delete
          anything from your social accounts. Removing a published post from
          motif Social removes our record of it; the post stays live on the
          platform until you remove it there.
        </p>
      </Section>

      <Section title="What you are responsible for">
        <p>
          The content you publish, and its compliance with each platform&rsquo;s
          policies and with the law where you operate. We will suspend an
          account being used to publish content that is illegal or that breaks
          the platforms&rsquo; rules, since doing otherwise puts every other
          customer&rsquo;s access at risk.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          We do our best to publish on time, and we tell you when we cannot.
          Scheduling depends on services we do not control: if a platform is
          down or revokes an access token, a post may be late or may not go out.
          We will always tell you, and you will always be able to see what
          happened.
        </p>
      </Section>

      <Section title="Ending it">
        <p>
          You can stop at any time; your plan runs to the end of the cycle you
          have paid for. See{' '}
          <Link href="/legal/privacy" className="text-primary hover:underline">
            Privacy
          </Link>{' '}
          for how to have your data deleted.
        </p>
      </Section>
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  )
}
