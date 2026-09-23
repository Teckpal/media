// Pure, relative imports, no server-only: suggesting a hashtag is a decision
// worth testing, and the composer runs it in the browser on every keystroke.
import type { Platform } from '../constants.ts'

/**
 * Hashtag suggestions, without an AI provider.
 *
 * Two sources, and the order between them is the whole idea:
 *
 *  1. **The workspace's own profile** — brand name, industry, audience,
 *     keywords. These are the tags that should appear on most posts, because
 *     they are what the account is *about*. They come first and they are
 *     stable, which is the point: a feed where every post carries the same two
 *     or three brand tags is a feed that accumulates.
 *  2. **The caption** — what this particular post is about. Topical, changes
 *     every time, and worthless on its own.
 *
 * A suggester that only read the caption would propose #friday for a post
 * mentioning Friday, which is noise. One that only read the profile would
 * propose the same five tags forever. The useful answer is a few of each.
 *
 * Deterministic on purpose. The same caption and the same profile give the
 * same suggestions every time, so the list does not reshuffle under the
 * cursor while somebody is reading it.
 *
 * ### What this is not
 *
 * It does not know what is trending, what a competitor used, or what performed
 * last month. Nothing here reaches the network. When a provider is wired up it
 * can replace `suggestHashtags` behind the same signature — the composer only
 * knows about the return type.
 */

export type HashtagSuggestion = {
  /** Without the `#`, so the caller decides how to render it. */
  tag: string
  /** Why it was offered, for the tooltip and for ordering. */
  source: 'brand' | 'caption'
}

export type HashtagProfile = {
  brandName?: string | null
  industry?: string | null
  targetAudience?: string | null
  keywords?: readonly string[] | null
}

/**
 * How many hashtags each platform actually wants.
 *
 * Not the API limit — the norm. Instagram permits thirty and the posts that
 * read as spam are the ones that use thirty; X permits plenty and two is
 * already pushing it. The number here is what a person would use.
 */
export const HASHTAG_NORM: Record<Platform, number> = {
  instagram: 10,
  tiktok: 5,
  youtube: 5,
  linkedin: 3,
  facebook: 3,
  twitter: 2,
}

/**
 * The strictest norm among the chosen platforms.
 *
 * A post going to Instagram and X is one caption, and it obeys the tighter
 * rule — ten tags would be fine on Instagram and would wreck the X version.
 * With nothing chosen, Instagram's is the roomiest and makes the best default
 * while the composer is still empty.
 */
export function hashtagBudget(platforms: readonly Platform[]): number {
  if (platforms.length === 0) return HASHTAG_NORM.instagram
  return Math.min(...platforms.map((platform) => HASHTAG_NORM[platform]))
}

/**
 * Words that carry no topic.
 *
 * Deliberately short. A longer list would need maintaining and would still
 * miss things; the length filter below does most of the work, and a suggestion
 * nobody wants costs one glance, where a missing one costs a thought.
 */
const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'always', 'another', 'anything', 'around',
  'because', 'been', 'before', 'being', 'best', 'better', 'between', 'both',
  'called', 'come', 'coming', 'could', 'day', 'days', 'does', 'doing', 'done',
  'down', 'each', 'even', 'every', 'everyone', 'everything', 'first', 'from',
  'gets', 'getting', 'give', 'going', 'good', 'great', 'have', 'here', 'into',
  'its', 'just', 'know', 'like', 'liked', 'little', 'look', 'looking', 'made',
  'make', 'making', 'many', 'more', 'most', 'much', 'need', 'never', 'new',
  'next', 'now', 'off', 'once', 'only', 'other', 'our', 'out', 'over', 'own',
  'part', 'people', 'place', 'really', 'right', 'same', 'see', 'should',
  'since', 'some', 'something', 'soon', 'still', 'such', 'take', 'than',
  'that', 'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'things',
  'think', 'this', 'those', 'through', 'time', 'today', 'too', 'under', 'use',
  'used', 'using', 'very', 'want', 'was', 'way', 'well', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'without',
  'would', 'you', 'your', 'yours',
  // Days and months are the classic false positive: a post that says "Friday"
  // is not a post about Fridays.
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
])

const MIN_WORD = 4

/**
 * The suggestions, best first.
 *
 * `budget` is a hint, not a cap: more are returned than a platform wants, so
 * there is something to choose between. The composer shows the budget and
 * counts against it.
 */
export function suggestHashtags(input: {
  caption: string
  profile?: HashtagProfile | null
  platforms?: readonly Platform[]
  /** How many to return. */
  limit?: number
}): HashtagSuggestion[] {
  const limit = input.limit ?? 12
  const profile = input.profile ?? {}

  // Already in the caption, so not a suggestion. Compared lower-cased because
  // #SpringCollection and #springcollection are the same tag to every platform
  // that matters.
  const present = new Set(
    [...input.caption.matchAll(/#([\p{L}\p{N}\p{M}_]+)/gu)].map((m) => m[1].toLowerCase()),
  )

  const seen = new Set<string>()
  const out: HashtagSuggestion[] = []

  const add = (raw: string, source: HashtagSuggestion['source']) => {
    const tag = toTag(raw)
    if (!tag) return
    const key = tag.toLowerCase()
    if (present.has(key) || seen.has(key)) return
    seen.add(key)
    out.push({ tag, source })
  }

  // --- brand first ---------------------------------------------------------
  // Explicit keywords before inferred ones: somebody typed those in.
  for (const keyword of profile.keywords ?? []) add(keyword, 'brand')

  if (profile.industry) {
    add(profile.industry, 'brand')
    for (const word of meaningfulWords(profile.industry)) add(word, 'brand')
  }

  if (profile.brandName) add(profile.brandName, 'brand')

  if (profile.targetAudience) {
    for (const word of meaningfulWords(profile.targetAudience)) add(word, 'brand')
  }

  // --- then what this post is about ----------------------------------------
  // Ordered by how often the word appears, then by length — a word repeated in
  // a caption is what the caption is about, and a longer word is a more
  // specific tag than a shorter one.
  const counts = new Map<string, number>()
  for (const word of meaningfulWords(input.caption)) {
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }

  const ranked = [...counts.entries()].sort((a, b) =>
    b[1] === a[1] ? b[0].length - a[0].length : b[1] - a[1],
  )

  for (const [word] of ranked) add(word, 'caption')

  return out.slice(0, limit)
}

/** Words worth considering, lower-cased, in the order they appear. */
function meaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    /**
     * Split on anything that is not a letter, a digit or a combining mark.
     *
     * `\p{M}` is the part that is easy to leave out and wrong to. Bangla
     * writes its vowels as marks attached to a consonant — the ু in নতুন is
     * U+09C1, category Mn, neither a letter nor a digit. Without it the
     * splitter treated every vowel sign as punctuation and cut নতুন into two
     * fragments, so Bangla captions produced no suggestions at all. The same
     * goes for Devanagari, Arabic and decomposed accented Latin.
     */
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((word) => word.length >= MIN_WORD && !STOPWORDS.has(word) && !/^\d+$/.test(word))
}

/**
 * "spring collection" -> "SpringCollection".
 *
 * Multi-word phrases are camel-cased rather than run together, because
 * #springcollection is unreadable and #SpringCollection is not — and the two
 * are the same tag to the platform, so the readable one is free.
 */
export function toTag(raw: string): string | null {
  const parts = raw
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)
    // A phrase like "small business owners in Dhaka" should not become a
    // sentence-long tag. Four words is already more than anybody reads.
    .slice(0, 4)

  if (parts.length === 0) return null

  const tag =
    parts.length === 1
      ? parts[0]
      : parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')

  // A tag has to start with a letter on every platform that parses them.
  if (!/^\p{L}/u.test(tag)) return null

  return tag.length > 30 ? null : tag
}
