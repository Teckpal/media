'use client'

import { useEffect, useRef, type HTMLAttributes } from 'react'

/**
 * A soft light that follows the cursor.
 *
 * Four things differ from the usual version of this, all of them for a reason:
 *
 *  - **It stops.** The original keeps a `requestAnimationFrame` loop running
 *    for the life of the page whether the pointer moved or not, which is a
 *    steady drain on a laptop for a decoration nobody is looking at. This one
 *    runs only while the light is actually travelling and parks itself once it
 *    has settled.
 *  - **`smoothing` is wired up.** It was declared and then ignored, so the
 *    light snapped to the cursor. Here it eases towards it, which is the whole
 *    point of the prop.
 *  - **It is sharp.** The canvas is sized in device pixels, so the gradient is
 *    not resampled up on a retina screen.
 *  - **It leaves on `pointerout`**, not `mouseleave` on `window` — which
 *    essentially never fires, so the light used to stick to the last known
 *    position after the pointer had gone.
 *
 * It draws nothing at all for a visitor who has asked for reduced motion, and
 * nothing for a coarse pointer: there is no cursor to follow on a phone.
 */

export type SpotlightConfig = {
  radius?: number
  brightness?: number
  color?: string
  /** 0 is instant, 1 never arrives. Roughly how much of the gap is closed each frame. */
  smoothing?: number
}

export type SpotlightCursorProps = HTMLAttributes<HTMLCanvasElement> & {
  config?: SpotlightConfig
}

function hexToRgb(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return '255,255,255'
  const n = parseInt(match[1], 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

export function SpotlightCursor({ config = {}, className, ...rest }: SpotlightCursorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const settings = useRef({
    radius: 200,
    brightness: 0.15,
    color: '#ffffff',
    smoothing: 0.1,
    ...config,
  })
  useEffect(() => {
    settings.current = {
      radius: 200,
      brightness: 0.15,
      color: '#ffffff',
      smoothing: 0.1,
      ...config,
    }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const coarse = window.matchMedia('(pointer: coarse)')
    if (reduced.matches || coarse.matches) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    let disposed = false

    // Where the light is, and where it is heading. Off-screen means "no pointer".
    const light = { x: -9999, y: -9999, tx: -9999, ty: -9999, seen: false }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = () => {
      if (disposed) return
      const { radius, brightness, color, smoothing } = settings.current

      const ease = 1 - Math.min(Math.max(smoothing, 0), 0.99)
      light.x += (light.tx - light.x) * ease
      light.y += (light.ty - light.y) * ease

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

      if (light.seen) {
        const gradient = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, radius)
        gradient.addColorStop(0, `rgba(${hexToRgb(color)}, ${brightness})`)
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
      }

      // Parked once it has caught up. A pointer move starts it again.
      const settled =
        Math.abs(light.tx - light.x) < 0.5 && Math.abs(light.ty - light.y) < 0.5
      frame = settled ? 0 : requestAnimationFrame(draw)
    }

    const start = () => {
      if (frame || disposed) return
      frame = requestAnimationFrame(draw)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      light.tx = event.clientX
      light.ty = event.clientY
      if (!light.seen) {
        // First sighting: put the light where the pointer is rather than
        // sliding it in from the corner.
        light.seen = true
        light.x = event.clientX
        light.y = event.clientY
      }
      start()
    }

    /** The pointer left the window entirely — `relatedTarget` is null. */
    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget) return
      light.seen = false
      start()
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerout', onPointerOut)
    start()

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerout', onPointerOut)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-50 h-full w-full ${className ?? ''}`}
      {...rest}
    />
  )
}

export default SpotlightCursor
