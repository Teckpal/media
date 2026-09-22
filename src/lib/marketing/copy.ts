// Pure, relative imports. The landing pages are the one place where what the
// product *claims* can drift from what it does, so the claims live here where
// they can be read in one sitting — and tested.
import type { BillingRegion } from '../constants.ts'

/**
 * Section 7A.1: two landing pages, one per region.
 *
 * Two rules hold this together, and both are checked by the tests beside it:
 *
 * 1. **No prices here.** Section 7A.3 says the server reads the price from the
 *    database by region. A number typed into marketing copy is a number that
 *    will still be there six months after the price changed.
 * 2. **Nothing is promised that is not built.** Phase 1 is Facebook Pages and
 *    Instagram business accounts (Section 11). The other four platforms are
 *    named as coming, never as available, and the Global page does not imply a
 *    card checkout that Section 13 Q6 has not yet chosen a provider for.
 */

export type FaqItem = { question: string; answer: string }

export type RegionCopy = {
  region: BillingRegion
  path: string
  /** For `alternates.languages`, so each page points at the other. */
  locale: string
  metaTitle: string
  metaDescription: string

  hero: {
    eyebrow: string
    heading: string
    subheading: string
    primaryCta: { label: string; href: string }
    secondaryCta: { label: string; href: string }
  }

  /** Three short lines under the hero. Facts, not adjectives. */
  proofPoints: string[]

  features: { title: string; body: string }[]

  /** How you actually operate it, in the order you meet each step. */
  steps: { title: string; body: string }[]

  /** The networks, and whether you can post to them today. */
  networks: Network[]

  /** The three columns of "what it does". */
  pillars: Pillar[]

  /** Promises stated as refusals, which are the ones worth believing. */
  refusals: { title: string; body: string }[]

  pricingHeading: string
  pricingNote: string
  /** How money actually moves in this region. */
  paymentsLine: string

  faq: FaqItem[]

  /** The nudge to the other region's page. Never an automatic redirect. */
  otherRegion: { prompt: string; label: string; path: string }
}

/**
 * Section 4's onboarding, told as the visitor will meet it.
 *
 * The order is the order the router gate enforces, so the page cannot promise
 * a path through the product that the software will not let anyone walk.
 */
/**
 * `live` means you can use it today. Anything else is `planned`, and the page
 * has to say so — Section 11 puts four of the six networks in later phases, and
 * a landing page that lists them flat is a landing page that lies.
 */
export type Availability = 'live' | 'planned'

export type Network = { name: string; art: string; status: Availability }

export type Pillar = {
  title: string
  items: { label: string; status: Availability }[]
}

/**
 * The six networks from Section 1, in the order Section 11 builds them.
 *
 * The artwork is keyed by `art` rather than by name so a rename cannot silently
 * break an image, and every file here exists in `public/art`.
 */
const NETWORKS: Network[] = [
  { name: 'Facebook Page', art: 'facebook', status: 'live' },
  { name: 'Instagram', art: 'instagram', status: 'live' },
  { name: 'LinkedIn', art: 'linkedin', status: 'planned' },
  { name: 'YouTube', art: 'youtube', status: 'planned' },
  { name: 'TikTok', art: 'tiktok', status: 'planned' },
  { name: 'X', art: 'x', status: 'planned' },
]

/**
 * What the product does, in three columns.
 *
 * `planned` is used strictly: a thing counts as live only if somebody can do it
 * in the app today. Approvals and team invitations have their tables and their
 * rules in the database and no screen yet, which makes them planned — the
 * database being ready is not the same as the feature existing.
 */
const PILLARS: Pillar[] = [
  {
    title: 'Publishing',
    items: [
      { label: 'Publishing and scheduling', status: 'live' },
      { label: 'A calendar in your own timezone', status: 'live' },
      { label: 'A queue that never sends twice', status: 'live' },
      { label: 'Pause a scheduled post, resume it later', status: 'live' },
      { label: 'Retries, then an honest failure', status: 'live' },
      { label: 'Bulk upload from a spreadsheet', status: 'planned' },
    ],
  },
  {
    title: 'Working together',
    items: [
      { label: 'Owner, admin, editor and viewer roles', status: 'live' },
      { label: 'Per-workspace access, checked on the server', status: 'live' },
      { label: 'Team invitations', status: 'planned' },
      { label: 'Approval steps before anything goes out', status: 'planned' },
      { label: 'A client who approves from a link, with no account', status: 'planned' },
      { label: 'Saved captions and templates', status: 'planned' },
    ],
  },
  {
    title: 'Connecting up',
    items: [
      { label: 'Facebook Pages and Instagram business accounts', status: 'live' },
      { label: 'Tokens encrypted, never readable by a browser', status: 'live' },
      { label: 'In-app and email alerts when something breaks', status: 'live' },
      { label: 'LinkedIn and YouTube, then TikTok and X', status: 'planned' },
      { label: 'AI captions and suggested posting times', status: 'planned' },
      { label: 'Run the tool from WhatsApp', status: 'planned' },
    ],
  },
]

/**
 * Section 6 and Section 7, read as promises.
 *
 * Every one of these is a rule the database enforces rather than a preference
 * the interface expresses, which is the only reason they are worth printing.
 */
const REFUSALS: RegionCopy['refusals'] = [
  {
    title: 'It will not publish without a subscription that covers the account',
    body: 'The check happens on the server, next to the data, every time. A crafted request gets no further than the button does.',
  },
  {
    title: 'It will not send the same post twice',
    body: 'Every post and target carries a key the database refuses to accept a second time. Two workers running at once divide the work instead of duplicating it.',
  },
  {
    title: 'It will not quietly reach into your page',
    body: 'Deleting a published post removes it from here and says plainly that it stays live on the platform. Deleting it there is done there, by you.',
  },
  {
    title: 'It will not delete your work for not paying',
    body: 'Publishing pauses three days after a missed payment. Drafts, media, the calendar and your connections all stay exactly where they were.',
  },
]

const SHARED_STEPS: RegionCopy['steps'] = [
  {
    title: 'Create your workspace',
    body: 'Sign up, confirm your email, and say whether you are posting for yourself or for a business. It takes a minute and decides what the rest of the app shows you.',
  },
  {
    title: 'Connect an account',
    body: 'Sign in to Facebook and pick the Page — and the Instagram business account attached to it — that you want to post to. An account already connected to another workspace is refused, so two people cannot post to the same Page by accident.',
  },
  {
    title: 'Write, or plan the month',
    body: 'Draft a post and see it checked against each platform’s rules as you type. Drag it on the calendar to schedule it. Nothing publishes until you say so.',
  },
  {
    title: 'Let it go out, and hear about it',
    body: 'Scheduled posts are published by a queue that retries on failure and tells you — in the app and by email — if a post did not make it or a connection needs renewing.',
  },
]

const SHARED_FEATURES: RegionCopy['features'] = [
  {
    title: 'One calendar for every account',
    body: 'Plan the month in one place. Posts are stored in UTC and shown in your workspace’s timezone, so a colleague travelling does not move when the 9am post goes out.',
  },
  {
    title: 'Facebook Pages and Instagram business accounts',
    body: 'Connect the accounts you manage and publish to them together. LinkedIn, YouTube, TikTok and X are planned; they are not here yet, and we would rather say so.',
  },
  {
    title: 'Checked before it goes out, not after',
    body: 'Every post is validated against each platform’s own rules as you write it — Instagram will not take a post without an image, and you find that out now rather than at nine in the morning.',
  },
  {
    title: 'It tells you when something breaks',
    body: 'If a token expires or a post fails, the workspace is told in the app and by email, with the reason and what to do about it. Nothing fails quietly.',
  },
  {
    title: 'A team, with the right permissions',
    body: 'Owners handle billing, admins run the workspace, editors write and schedule, viewers look. Turn on approvals and an editor’s post waits for a yes.',
  },
  {
    title: 'Your drafts outlive your subscription',
    body: 'If a payment lapses, publishing pauses and everything else stays exactly where it is. Nothing is deleted for not paying.',
  },
]

const SHARED_FAQ: FaqItem[] = [
  {
    question: 'Which platforms can I publish to today?',
    answer:
      'Facebook Pages and Instagram business accounts. Those are the two that are built and tested. LinkedIn and YouTube come next, then TikTok and X.',
  },
  {
    question: 'What happens if I stop paying?',
    answer:
      'Publishing pauses three days after the due date. Your drafts, calendar, connected accounts and uploaded media all stay. Pay the invoice and your scheduled posts resume where they were.',
  },
  {
    question: 'Can I delete a post after it has gone out?',
    answer:
      'You can remove it from motif Social, and we will say clearly that it stays live on Facebook or Instagram — deleting it there is done there. We will not quietly reach into your page.',
  },
  {
    question: 'How is it priced?',
    answer:
      'Per connected account, per month. Two connected Pages cost twice one. There is no free tier for publishing, and no trial that quietly turns into a bill.',
  },
  {
    question: 'Who can see what?',
    answer:
      'Only members of your workspace. Access tokens for your accounts are encrypted before they are stored and are never readable by a browser, including yours.',
  },
]

export const GLOBAL_COPY: RegionCopy = {
  region: 'global',
  path: '/',
  locale: 'en',
  metaTitle: 'Plan, schedule and publish your social posts',
  metaDescription:
    'motif Social plans, schedules and publishes to your Facebook Pages and Instagram business accounts from one calendar. Priced per connected account.',

  hero: {
    eyebrow: 'Social scheduling, without the surprises',
    heading: 'Plan the month. Publish on time.',
    subheading:
      'One calendar for every Page and Instagram account you look after — with the platform’s own rules checked before a post is scheduled, not after it fails.',
    primaryCta: { label: 'Create your account', href: '/signup' },
    secondaryCta: { label: 'See how it works', href: '#how' },
  },

  proofPoints: [
    'Facebook Pages and Instagram business accounts',
    'Priced per connected account, per month',
    'Your drafts stay yours whether or not you are paying',
  ],

  features: SHARED_FEATURES,
  steps: SHARED_STEPS,
  networks: NETWORKS,
  pillars: PILLARS,
  refusals: REFUSALS,

  pricingHeading: 'Priced per connected account',
  pricingNote:
    'One monthly price for each Page or Instagram account you publish to. Every package includes AI credits for planning.',
  paymentsLine:
    'Card payments outside Bangladesh are not open for self-service yet — we are still choosing the right provider rather than picking one quickly. Create your account, connect your pages, and talk to us: we will set your plan up directly.',

  faq: SHARED_FAQ,

  otherRegion: {
    prompt: 'In Bangladesh?',
    label: 'See prices in taka',
    path: '/bd',
  },
}

export const BD_COPY: RegionCopy = {
  region: 'bd',
  path: '/bd',
  locale: 'en-BD',
  metaTitle: 'Social scheduling for Bangladeshi brands',
  metaDescription:
    'Plan, schedule and publish to your Facebook Pages and Instagram business accounts from one calendar. Priced in taka, paid with bKash, Nagad, Rocket or a card.',

  hero: {
    eyebrow: 'Built for Bangladeshi brands and agencies',
    heading: 'Plan the month. Publish on time.',
    subheading:
      'One calendar for every Page and Instagram account you look after, priced in taka and paid the way you already pay for everything else.',
    primaryCta: { label: 'Create your account', href: '/signup' },
    secondaryCta: { label: 'See how it works', href: '#how' },
  },

  proofPoints: [
    'Facebook Pages and Instagram business accounts',
    'Taka pricing, per connected account, per month',
    'bKash, Nagad, Rocket, internet banking and cards',
  ],

  features: SHARED_FEATURES,
  steps: SHARED_STEPS,
  networks: NETWORKS,
  pillars: PILLARS,
  refusals: REFUSALS,

  pricingHeading: 'Priced in taka, per connected account',
  pricingNote:
    'One monthly price for each Page or Instagram account you publish to. Every package includes AI credits for planning.',
  paymentsLine:
    'Paid through SSLCommerz: bKash, Nagad, Rocket, internet banking and Bangladeshi cards. Your prices stay in taka — the payment method you use is what fixes your region, and it does not change underneath you afterwards.',

  faq: [
    ...SHARED_FAQ,
    {
      question: 'Can I pay with bKash?',
      answer:
        'Yes — bKash, Nagad, Rocket, internet banking and cards, all through SSLCommerz. You will get an invoice for each cycle and a reminder a week before it is due.',
    },
    {
      question: 'Is the price in taka fixed?',
      answer:
        'Your region is settled by the payment method you first use, and after that your billing stays in taka. Moving region is a support request at renewal, not something that can happen by accident.',
    },
  ],

  otherRegion: {
    prompt: 'Outside Bangladesh?',
    label: 'See prices in dollars',
    path: '/',
  },
}

export const REGION_COPY: Record<BillingRegion, RegionCopy> = {
  bd: BD_COPY,
  global: GLOBAL_COPY,
}

export function copyFor(region: BillingRegion): RegionCopy {
  return REGION_COPY[region]
}
