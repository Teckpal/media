'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * A card with a back, turned by click, drag or keyboard.
 *
 * The motion is a real spring integrated per frame rather than a CSS
 * transition, because a drag has to hand the card over mid-gesture with the
 * velocity it already had — a transition can only start from rest, so releasing
 * a half-turned card would make it stop dead and then begin again.
 *
 * Nothing animates for a visitor who has asked for reduced motion: the card
 * snaps between faces and stays entirely usable, since the flip is a state
 * change and only the turning is decoration.
 *
 * It is a `button` with `aria-pressed`, and the hidden face is `inert`, so a
 * keyboard cannot tab into content that is facing away from it.
 */

export type FlipCardProps = {
  front: ReactNode
  back: ReactNode
  /** 'y' turns about the vertical axis (left-right), 'x' about the horizontal. */
  axis?: 'x' | 'y'
  flipOnClick?: boolean
  /** Which face the card starts on. Useful for previews and for a card whose
      back is the more important side. */
  defaultFlipped?: boolean
  draggable?: boolean
  /**
   * Pixels of drag needed to complete a flip on release. `0` means the card
   * follows the pointer and settles to whichever face it is nearer.
   */
  dragDistance?: number
  tilt?: boolean
  tiltMax?: number
  glare?: boolean
  glareOpacity?: number
  hoverScale?: number
  perspective?: number
  stiffness?: number
  damping?: number
  /** Omit either for a card that fills its grid cell. */
  width?: number
  height?: number
  radius?: number
  background?: string
  color?: string
  shadow?: boolean
  shadowColor?: string
  shadowOpacity?: number
  onFlipChange?: (flipped: boolean) => void
  className?: string
  /** Names the control for a screen reader, since the faces are decorative to it. */
  label?: string
}

/** How far the pointer must travel before a drag stops being a click. */
const DRAG_SLOP = 6

export default function FlipCard({
  front,
  back,
  axis = 'y',
  flipOnClick = true,
  defaultFlipped = false,
  draggable = false,
  dragDistance = 0,
  tilt = false,
  tiltMax = 12,
  glare = false,
  glareOpacity = 0.22,
  hoverScale = 1,
  perspective = 1100,
  stiffness = 170,
  damping = 20,
  width,
  height,
  radius = 14,
  background = '#27272a',
  color = '#f5f5f5',
  shadow = false,
  shadowColor = '#000000',
  shadowOpacity = 0.45,
  onFlipChange,
  className,
  label,
}: FlipCardProps) {
  const hostRef = useRef<HTMLButtonElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const glareRef = useRef<HTMLDivElement | null>(null)

  const [flipped, setFlipped] = useState(defaultFlipped)
  const backId = useId()

  /** Everything the animation loop reads, kept out of React's render path. */
  const motion = useRef({
    angle: defaultFlipped ? 180 : 0,
    velocity: 0,
    target: defaultFlipped ? 180 : 0,
    tiltX: 0,
    tiltY: 0,
    tiltTargetX: 0,
    tiltTargetY: 0,
    scale: 1,
    scaleTarget: 1,
    dragging: false,
    dragged: false,
    startPointer: 0,
    startAngle: 0,
    frame: 0,
    reduced: false,
  })

  const settings = useRef({ axis, stiffness, damping, tiltMax, hoverScale, glare, glareOpacity })
  useEffect(() => {
    settings.current = { axis, stiffness, damping, tiltMax, hoverScale, glare, glareOpacity }
  })

  /**
   * The loop lives in one effect rather than in `useCallback`s.
   *
   * Every one of these functions mutates `motion.current`, and a memoised
   * callback that mutates a captured ref is exactly what the compiler's
   * immutability rule is there to catch. Built once here, handed out through
   * `api`, they are plain closures over a ref — which is the shape this has
   * always wanted to be.
   */
  const api = useRef<{ start: () => void; paint: () => void } | null>(null)

  useEffect(() => {
    const m = motion.current

    const paint = () => {
      const { axis: a, tiltMax: max, glareOpacity: op } = settings.current
      const inner = innerRef.current
      if (!inner) return

      const spin = a === 'y' ? `rotateY(${m.angle}deg)` : `rotateX(${m.angle}deg)`
      inner.style.transform = `rotateX(${m.tiltX}deg) rotateY(${m.tiltY}deg) scale(${m.scale}) ${spin}`

      if (glareRef.current) {
        // Tied to the tilt rather than to raw pointer position, so the
        // highlight agrees with the way the card is actually leaning.
        const x = 50 + (m.tiltY / Math.max(max, 1)) * 50
        const y = 50 - (m.tiltX / Math.max(max, 1)) * 50
        glareRef.current.style.background =
          `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,${op}), transparent 60%)`
      }
    }

    const tick = () => {
      const { stiffness: k, damping: c } = settings.current

      // A fixed step, so the spring behaves the same on a 60Hz screen and a
      // 144Hz one.
      const dt = 1 / 60

      if (!m.dragging) {
        const force = -k * (m.angle - m.target) - c * m.velocity
        m.velocity += force * dt
        m.angle += m.velocity * dt
      }

      m.tiltX += (m.tiltTargetX - m.tiltX) * 0.15
      m.tiltY += (m.tiltTargetY - m.tiltY) * 0.15
      m.scale += (m.scaleTarget - m.scale) * 0.15

      paint()

      const atRest =
        !m.dragging &&
        Math.abs(m.angle - m.target) < 0.05 &&
        Math.abs(m.velocity) < 0.05 &&
        Math.abs(m.tiltTargetX - m.tiltX) < 0.05 &&
        Math.abs(m.tiltTargetY - m.tiltY) < 0.05 &&
        Math.abs(m.scaleTarget - m.scale) < 0.001

      if (atRest) {
        m.angle = m.target
        m.velocity = 0
        m.tiltX = m.tiltTargetX
        m.tiltY = m.tiltTargetY
        m.scale = m.scaleTarget
        paint()
        m.frame = 0
        return
      }

      m.frame = requestAnimationFrame(tick)
    }

    const start = () => {
      if (m.frame) return
      if (m.reduced) {
        // Snap. The card stays entirely usable; only the turning was decoration.
        m.angle = m.target
        m.velocity = 0
        m.tiltX = m.tiltTargetX
        m.tiltY = m.tiltTargetY
        m.scale = m.scaleTarget
        paint()
        return
      }
      m.frame = requestAnimationFrame(tick)
    }

    api.current = { start, paint }

    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    m.reduced = query.matches
    const onChange = () => {
      m.reduced = query.matches
    }
    query.addEventListener('change', onChange)

    paint()

    return () => {
      query.removeEventListener('change', onChange)
      if (m.frame) cancelAnimationFrame(m.frame)
      m.frame = 0
      api.current = null
    }
  }, [])

  const start = useCallback(() => {
    api.current?.start()
  }, [])

  const paint = useCallback(() => {
    api.current?.paint()
  }, [])

  const setFlip = useCallback(
    (next: boolean) => {
      const m = motion.current
      m.target = next ? 180 : 0
      setFlipped(next)
      onFlipChange?.(next)
      start()
    },
    [onFlipChange, start],
  )

  // --- pointer -------------------------------------------------------------

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const m = motion.current

    if (m.dragging) {
      const host = hostRef.current
      if (!host) return
      const span = axis === 'y' ? host.clientWidth : host.clientHeight
      const delta =
        (axis === 'y' ? event.clientX - m.startPointer : m.startPointer - event.clientY) /
        Math.max(span, 1)
      m.angle = m.startAngle + delta * 180
      if (Math.abs(delta * span) > DRAG_SLOP) m.dragged = true
      paint()
      return
    }

    if (!tilt && !glare) return
    const rect = event.currentTarget.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width - 0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5
    m.tiltTargetX = tilt ? -py * tiltMax * 2 : 0
    m.tiltTargetY = tilt ? px * tiltMax * 2 : 0
    start()
  }

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggable) return
    const m = motion.current
    m.dragging = true
    m.dragged = false
    m.startPointer = axis === 'y' ? event.clientX : event.clientY
    m.startAngle = m.angle
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const m = motion.current
    if (!m.dragging) return
    m.dragging = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const travelled = Math.abs(m.angle - m.startAngle)
    const wasFlipped = m.startAngle >= 90

    // `dragDistance: 0` means "settle to whichever face it is nearer", which is
    // the behaviour a card that follows your finger should have.
    const next =
      dragDistance > 0
        ? travelled * (Math.max(hostRef.current?.clientWidth ?? 1, 1) / 180) >= dragDistance
          ? !wasFlipped
          : wasFlipped
        : ((m.angle % 360) + 360) % 360 > 90 && ((m.angle % 360) + 360) % 360 < 270

    setFlip(next)
  }

  const onPointerLeave = (event: React.PointerEvent<HTMLButtonElement>) => {
    const m = motion.current
    m.tiltTargetX = 0
    m.tiltTargetY = 0
    m.scaleTarget = 1
    if (m.dragging) endDrag(event)
    start()
  }

  const onClick = () => {
    // A drag that happened to end where it started is not a click.
    if (motion.current.dragged) {
      motion.current.dragged = false
      return
    }
    if (flipOnClick) setFlip(!flipped)
  }

  const face: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    borderRadius: radius,
    overflow: 'hidden',
    background,
    color,
  }

  return (
    <button
      ref={hostRef}
      type="button"
      aria-pressed={flipped}
      aria-label={label}
      aria-describedby={backId}
      onClick={onClick}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={onPointerLeave}
      onPointerEnter={() => {
        motion.current.scaleTarget = hoverScale
        start()
      }}
      className={className}
      style={{
        perspective,
        width: width ?? '100%',
        height: height ?? '100%',
        borderRadius: radius,
        display: 'block',
        textAlign: 'inherit',
        touchAction: draggable && axis === 'y' ? 'pan-y' : 'auto',
        cursor: flipOnClick || draggable ? 'pointer' : 'default',
        filter: shadow ? `drop-shadow(0 18px 30px ${withAlpha(shadowColor, shadowOpacity)})` : undefined,
      }}
    >
      <div
        ref={innerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          willChange: 'transform',
        }}
      >
        <div style={face} inert={flipped ? true : undefined}>
          {front}
          {glare ? (
            <div
              ref={glareRef}
              aria-hidden
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            />
          ) : null}
        </div>

        <div
          id={backId}
          style={{
            ...face,
            transform: axis === 'y' ? 'rotateY(180deg)' : 'rotateX(180deg)',
          }}
          inert={flipped ? undefined : true}
        >
          {back}
        </div>
      </div>
    </button>
  )
}

/** `#rrggbb` plus an alpha, falling back to the colour untouched. */
function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return hex
  const n = parseInt(match[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
