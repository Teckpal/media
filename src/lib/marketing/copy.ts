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

  pricingHeading: string
  pricingNote: string
  /** How money actually moves in this region. */
  paymentsLine: string

  faq: FaqItem[]

  /** The nudge to the other region's page. Never an automatic redirect. */
  otherRegion: { prompt: string; label: string; path: string }
}

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
