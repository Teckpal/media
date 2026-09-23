/**
 * The notification tune.
 *
 * Synthesised rather than shipped. A two-note chime is about forty lines of
 * Web Audio and nothing to download, nothing to cache, and nothing to get
 * wrong about formats — where an mp3 would be a binary in the repository that
 * every visitor fetches whether or not they ever hear it.
 *
 * Two rules it obeys:
 *
 *  - **It never plays before the person has interacted with the page.**
 *    Browsers block it anyway, but the block leaves a suspended AudioContext
 *    behind, and enough of those produce a console full of warnings. So the
 *    context is created on the first real gesture and not before.
 *  - **It is off for anyone who has asked for less.** `prefers-reduced-motion`
 *    is the closest signal a browser gives for "stop surprising me", and a
 *    sound arriving unbidden is exactly that.
 */

const STORAGE_KEY = 'motif_chime'

let context: AudioContext | null = null

/** Starts the audio context. Safe to call repeatedly; only the first counts. */
export function primeChime(): void {
  if (context || typeof window === 'undefined') return

  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return

  try {
    context = new Ctor()
  } catch {
    // Some browsers refuse before a gesture. The next call tries again.
    context = null
  }
}

export function chimeMuted(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'off'
  } catch {
    // Private mode, or storage blocked. Audible is the default everywhere else,
    // so it is the default here too.
    return false
  }
}

export function setChimeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on')
  } catch {
    /* nothing to do; the preference simply does not persist */
  }
}

/**
 * Two notes, a fifth apart, each a short sine with a soft envelope.
 *
 * The envelope is the part that matters: a bare oscillator starting and
 * stopping at full amplitude clicks, and the click is what makes a synthesised
 * sound feel cheap. Ramping in over 8ms and out over the tail removes it.
 */
export function playChime(): void {
  if (typeof window === 'undefined') return
  if (chimeMuted()) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  primeChime()
  if (!context) return

  // Suspended after a tab was backgrounded. Resuming is allowed here because
  // this only ever runs downstream of a real notification.
  if (context.state === 'suspended') void context.resume()

  const now = context.currentTime
  const master = context.createGain()
  master.gain.value = 0.12
  master.connect(context.destination)

  // E5 then B5: a rising fifth reads as "something arrived" rather than
  // "something went wrong", which a falling interval would.
  const notes = [
    { hz: 659.25, at: 0, for: 0.18 },
    { hz: 987.77, at: 0.1, for: 0.28 },
  ]

  for (const note of notes) {
    const osc = context.createOscillator()
    const gain = context.createGain()

    osc.type = 'sine'
    osc.frequency.value = note.hz

    const start = now + note.at
    const end = start + note.for

    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(1, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)

    osc.connect(gain)
    gain.connect(master)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}
