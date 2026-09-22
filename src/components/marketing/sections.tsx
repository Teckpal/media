import { Check, Clock } from 'lucide-react'
import type { RegionCopy } from '@/lib/marketing/copy'

/**
 * The body sections of the landing page.
 *
 * They share one rule: anything not built yet is marked, every time, in the
 * same way. Section 7A.1's landing pages are where a claim can most easily
 * drift from the software, so "planned" is a visible state here rather than an
 * omission — a list that quietly leaves out what is missing reads exactly like
 * a list where everything works.
 */

function Marker({ status }: { status: 'live' | 'planned' }) {
  return status === 'live' ? (
    <Check className="mt-0.5 size-4 shrink-0 text-[var(--gold)]" aria-hidden />
  ) : (
    <Clock className="mt-0.5 size-4 shrink-0 text-white/35" aria-hidden />
  )
}

/** The strip of networks, with the four that are not connected yet saying so. */
export function Networks({ networks }: { networks: RegionCopy['networks'] }) {
  return (
    <section className="bg-[var(--night-band)] py-16">
      <div className="mx-auto w-full max-w-6xl px-4 text-center sm:px-8">
        <h2 className="text-xs font-medium tracking-[0.18em] text-white/50 uppercase">
          The networks it is built for
        </h2>

        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {networks.map((network) => (
            <li
              key={network.name}
              className={`rounded-full border px-4 py-2 text-sm ${
                network.status === 'live'
                  ? 'border-white/25 text-white'
                  : 'border-white/10 text-white/45'
              }`}
            >
              {network.name}
              {network.status === 'planned' ? (
                <span className="ml-2 text-xs text-white/35">soon</span>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="mx-auto mt-8 max-w-2xl text-sm text-pretty text-white/55">
          A network is switched on only once its official rules have been read and
          the connection built and tested. Until then it is not offered, and this
          page says so rather than pretending.
        </p>
      </div>
    </section>
  )
}

/** "What it does", in three columns. */
export function Pillars({ pillars }: { pillars: RegionCopy['pillars'] }) {
  return (
    <section className="bg-[var(--night)] py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
        <h2 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
          What it does
        </h2>
        <p className="mt-4 max-w-2xl text-pretty text-white/60">
          Ticked is built and running today. The rest is coming, and is marked so
          you can tell the difference before you pay for anything.
        </p>

        <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((pillar) => (
            <div key={pillar.title}>
              <h3 className="text-sm font-medium tracking-[0.14em] text-[var(--gold)] uppercase">
                {pillar.title}
              </h3>
              <ul className="mt-5 space-y-3">
                {pillar.items.map((item) => (
                  <li key={item.label} className="flex gap-3 text-sm">
                    <Marker status={item.status} />
                    <span
                      className={item.status === 'live' ? 'text-white/85' : 'text-white/40'}
                    >
                      {item.label}
                      {item.status === 'planned' ? (
                        <span className="ml-1.5 text-xs text-white/30">coming</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The four steps, as the router gate actually enforces them. */
export function HowItWorks({ steps }: { steps: RegionCopy['steps'] }) {
  return (
    <section id="how" className="scroll-mt-20 bg-[var(--plum)] py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
        <h2 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
          How a post gets out
        </h2>
        <p className="mt-4 max-w-2xl text-pretty text-white/65">
          Four steps, in the order the app walks you through them.
        </p>

        {/* Separate tiles rather than one hairline-divided grid: four steps read
            as four things when they are four objects, and the seam-free version
            made them look like one table with dividers. */}
        <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="rounded-[14px] border border-white/15 bg-white/[0.06] p-6 transition-colors hover:border-white/30 hover:bg-white/[0.1]"
            >
              {/* From the index, so inserting a step cannot leave the page
                  counting "1, 2, 2, 4". */}
              <span
                aria-hidden
                className="inline-flex size-9 items-center justify-center rounded-[14px] bg-[var(--gold)]/15 text-sm font-semibold tabular-nums text-[var(--gold)]"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-4 font-semibold text-balance text-white">{step.title}</h3>
              <p className="mt-2 text-sm text-pretty text-white/65">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/** Promises stated as refusals, which are the ones worth believing. */
export function Refusals({ refusals }: { refusals: RegionCopy['refusals'] }) {
  return (
    <section className="bg-[var(--night)] py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
        <h2 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
          What it refuses to do
        </h2>
        <p className="mt-4 max-w-2xl text-pretty text-white/60">
          Most tools sell you what they can do. These are the things this one will
          not do — each of them a rule the database enforces, not a preference the
          screen expresses.
        </p>

        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          {refusals.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-7"
            >
              <h3 className="font-medium text-balance text-white">{item.title}</h3>
              <p className="mt-2.5 text-sm text-pretty text-white/60">{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
