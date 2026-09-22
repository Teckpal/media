'use client'

import { Check, RotateCw } from 'lucide-react'
import FlipCard from '@/components/ui/flip-card'

/**
 * One package, with its limits on the back.
 *
 * The price belongs on the front and the small print behind it: three cards
 * side by side are compared on price first, and a column of bullet points under
 * each one makes that comparison slower rather than better.
 *
 * The call to action deliberately sits OUTSIDE the card. `FlipCard` renders a
 * button, and a link inside a button is invalid HTML that behaves differently
 * in every browser — so the thing a visitor came to press is never buried on a
 * face they have to turn the card to reach.
 */
export function PlanCard({
  name,
  price,
  description,
  includes,
}: {
  name: string
  price: string
  description: string | null
  includes: string[]
}) {
  return (
    <FlipCard
      axis="y"
      flipOnClick
      draggable
      dragDistance={0}
      tilt
      tiltMax={9}
      glare
      glareOpacity={0.18}
      hoverScale={1.02}
      perspective={1100}
      stiffness={170}
      damping={20}
      height={300}
      radius={14}
      background="rgba(255,255,255,0.06)"
      color="#ffffff"
      shadow
      shadowColor="#000000"
      shadowOpacity={0.35}
      label={`${name}, ${price} per connected account per month. Show what is included.`}
      front={
        <div className="flex h-full flex-col border border-white/15 p-6 text-left">
          <p className="text-sm font-semibold tracking-[0.14em] text-[var(--gold)] uppercase">
            {name}
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-tight">{price}</p>
          <p className="mt-1 text-xs text-white/45">per connected account / month</p>

          {description ? (
            <p className="mt-4 text-sm text-pretty text-white/65">{description}</p>
          ) : null}

          <span className="mt-auto flex items-center gap-2 pt-4 text-xs text-white/45">
            <RotateCw className="size-3.5" aria-hidden />
            What&rsquo;s included
          </span>
        </div>
      }
      back={
        <div className="flex h-full flex-col border border-white/25 bg-white/[0.04] p-6 text-left">
          <p className="text-sm font-semibold tracking-[0.14em] text-[var(--gold)] uppercase">
            {name}
          </p>
          <ul className="mt-5 flex-1 space-y-2.5 text-sm text-white/80">
            {includes.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--gold)]" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
          <span className="flex items-center gap-2 pt-4 text-xs text-white/45">
            <RotateCw className="size-3.5" aria-hidden />
            Back to the price
          </span>
        </div>
      }
    />
  )
}
