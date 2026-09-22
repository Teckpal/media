import type { Metadata } from 'next'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What motif Social stores, why, and how to have it deleted.',
  alternates: { canonical: '/legal/privacy' },
}

/**
 * A privacy policy is not optional furniture here: Meta requires a privacy
 * policy URL and data-deletion instructions before it will review an app for
 * the permissions Module 4 needs (`pages_manage_posts` and the rest). So this
 * page is a dependency of going live, not a nicety.
 *
 * It describes what the code actually does — the encrypted token vault, the
 * private media bucket, the audit log — rather than the usual boilerplate. It
 * still needs a lawyer before launch, which the banner says plainly rather than
 * leaving someone to assume it has had one.
 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto w-full max-w-2xl space-y-8 px-4 py-16 sm:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        <p className="text-sm text-muted-foreground">
          What we store, why we store it, and how to get rid of it.
        </p>
      </header>

      <Alert tone="warning" title="Not yet reviewed by a lawyer">
        This describes what the software actually does today and is written to
        be accurate rather than to be comprehensive. It must be reviewed against
        Bangladeshi and EU requirements before launch.
      </Alert>

      <Section title="What we collect">
        <p>
          Your name and email address, so you can sign in and we can tell you
          when something needs your attention. The country your browser appears
          to be in, used once to guess which prices to show you.
        </p>
        <p>
          For each social account you connect: its name, its identifier on that
          platform, its profile picture, and an access token issued by the
          platform. We ask for the narrowest set of permissions that lets us
          publish what you schedule.
        </p>
        <p>
          The posts you write, the media you upload, and a record of what was
          published where and when.
        </p>
      </Section>

      <Section title="What we do not do">
        <p>
          We do not read your inbox, your direct messages or your private
          conversations on any platform — we never ask for the permissions that
          would allow it.
        </p>
        <p>
          We do not sell your data, and we do not use the content of your posts
          to train anything.
        </p>
        <p>
          We do not post on your behalf without being asked. Anything published
          was scheduled by someone in your workspace, and the record of who is
          kept.
        </p>
      </Section>

      <Section title="How your access tokens are kept">
        <p>
          Platform access tokens are encrypted before they are stored, with a
          key held outside the database, and are bound to the account they
          belong to — a token copied to another row cannot be decrypted. No
          browser can read them, including yours: the database refuses to serve
          those columns to a signed-in client at all.
        </p>
      </Section>

      <Section title="Your media">
        <p>
          Uploaded images and video live in a private bucket. Previews are
          served through links that expire, so a link that leaks does not become
          permanent access to an unpublished campaign.
        </p>
      </Section>

      <Section title="Who can see your work">
        <p>
          Members of your workspace, and nobody else. Access is enforced by the
          database itself rather than only by the application, so a request that
          goes around our interface gets no further than one that does not.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          You can disconnect a social account at any time from Connections. That
          revokes our stored token for it and stops anything further being
          published to it.
        </p>
        <p>
          To delete your account and everything in it, email{' '}
          <a className="text-primary hover:underline" href="mailto:privacy@motif.example">
            privacy@motif.example
          </a>{' '}
          from the address you signed up with. We remove your workspaces, posts,
          media and connections within 30 days. Records we are required to keep
          for tax purposes — invoices and payments — are kept for as long as the
          law requires and no longer.
        </p>
        <p>
          You can also remove motif Social from the outside: in Facebook, under
          Settings, Business integrations. That revokes our access immediately,
          and we treat it as a disconnection.
        </p>
      </Section>

      <Section title="Getting in touch">
        <p>
          <a className="text-primary hover:underline" href="mailto:privacy@motif.example">
            privacy@motif.example
          </a>
          .
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
