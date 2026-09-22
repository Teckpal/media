'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import type { Network } from '@/lib/marketing/copy'

/**
 * The hero's rotating network gallery.
 *
 * One artwork fills the frame and the strip below names what you are looking
 * at. It advances on its own, stops when you touch it, and stops for good if
 * the visitor has asked for reduced motion — an image that changes under you
 * while you are reading the heading in front of it is a real problem, not a
 * stylistic one.
 *
 * Every card is a button, so the gallery is reachable from the keyboard rather
 * than being a decoration that only a mouse can operate.
 */
const INTERVAL_MS = 4200

export function NetworkHero({ networks }: { networks: Network[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (paused) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % networks.length)
    }, INTERVAL_MS)

    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [paused, networks.length])

  const current = networks[index]

  return (
    <div
      className="absolute inset-0"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      {/*
        All of them mounted, cross-faded. Swapping the `src` of one <img> makes
        the hero flash white on a slow connection, which is the first thing a
        visitor would see.
      */}
      {networks.map((network, i) => (
        <Image
          key={network.art}
          src={`/art/${network.art}.webp`}
          alt=""
          fill
          // The first one blocks the page's largest paint, so it is not lazy.
          priority={i === 0}
          sizes="100vw"
          className={`object-cover transition-opacity duration-1000 ${
            i === index ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}

      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-[var(--night)] via-[var(--night)]/70 to-transparent"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-[var(--night)] via-transparent to-[var(--night)]/60"
      />

      {/* --- the strip --- */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-8 sm:px-8 sm:pb-10">
        <div className="mx-auto w-full max-w-6xl">
          <div
            className="flex gap-2 overflow-x-auto pb-2"
            role="tablist"
            aria-label="Networks"
          >
            {networks.map((network, i) => (
              <button
                key={network.art}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`${network.name}${network.status === 'planned' ? ' — planned' : ''}`}
                onClick={() => setIndex(i)}
                className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border transition-all sm:h-20 sm:w-32 ${
                  i === index
                    ? 'border-white/70 opacity-100'
                    : 'border-white/15 opacity-55 hover:opacity-85'
                }`}
              >
                <Image
                  src={`/art/${network.art}.webp`}
                  alt=""
                  fill
                  sizes="128px"
                  className="object-cover"
                />
                {network.status === 'planned' ? (
                  <span className="absolute inset-x-0 bottom-0 bg-black/65 py-0.5 text-[10px] font-medium tracking-wide text-white/80">
                    soon
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-4">
            <p className="text-sm font-medium text-white">
              {current.name}
              {current.status === 'planned' ? (
                <span className="ml-2 font-normal text-white/60">not connected yet</span>
              ) : null}
            </p>

            <div className="flex items-center gap-3 text-xs tabular-nums text-white/55">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <span className="relative block h-px w-24 bg-white/25 sm:w-40">
                <span
                  className="absolute inset-y-0 left-0 bg-white transition-[width] duration-500"
                  style={{ width: `${((index + 1) / networks.length) * 100}%` }}
                />
              </span>
              <span>{String(networks.length).padStart(2, '0')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
