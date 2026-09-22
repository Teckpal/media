import { z } from 'zod'

/**
 * Environment is validated once, at first import, on the server.
 *
 * Two schemas on purpose: `publicEnv` is the subset that is safe to reach the
 * browser, `serverEnv` holds the secrets. Importing `serverEnv` from a client
 * component is a build error, which is the point.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
})

let cachedPublic: z.infer<typeof publicSchema> | null = null

/**
 * Browser-safe configuration.
 *
 * Lazy, like `serverEnv`, so that merely importing a module does not throw.
 * A build has no reason to hold real credentials -- the values are only needed
 * when a request is actually served -- and validating at import time would make
 * `next build` fail on a machine that has none.
 *
 * The `process.env.NEXT_PUBLIC_*` reads stay literal so Next can still inline
 * them into the client bundle.
 */
export function publicEnv() {
  if (cachedPublic) return cachedPublic
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid public environment. Check: ${missing}`)
  }
  cachedPublic = parsed.data
  return cachedPublic
}

/**
 * The site's own origin, on its own.
 *
 * Separate from `publicEnv()` because of where it is needed: `robots.ts`,
 * `sitemap.ts` and the root layout's metadata all run during `next build`, and
 * `publicEnv()` validates the Supabase keys as well — so asking it for a URL
 * made a build require credentials it has no use for. Module 0 deliberately
 * made the validators lazy for that reason; this keeps that promise.
 *
 * It still refuses rather than guessing. A sitemap quietly published with
 * `localhost` in it is worse than a build that stops and names the variable.
 */
export function appUrl(): string {
  const parsed = z.string().url().safeParse(process.env.NEXT_PUBLIC_APP_URL)

  if (!parsed.success) {
    throw new Error('Invalid public environment. Check: NEXT_PUBLIC_APP_URL')
  }

  return parsed.data.replace(/\/$/, '')
}

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),

  // Comma-separated. Checked by the app's own API routes; gateway webhooks are
  // exempt, since they arrive from the gateway and prove themselves with a
  // signature instead.
  ALLOWED_ORIGINS: z.string().default(''),

  // The project's JWT signing secret. Supabase signs and verifies tokens with
  // it, so the app has no reason to read it -- it is declared here only so an
  // operator who sets it does not think the app is using it for something.
  AUTH_JWT_SECRET: z.string().optional(),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  // Meta ships a Graph API version roughly quarterly and retires old ones after
  // about two years. Pinned here so an upgrade is a config change; confirm the
  // current version in the Meta app dashboard before going live.
  META_GRAPH_VERSION: z.string().default('v23.0'),

  SSLCOMMERZ_STORE_ID: z.string().optional(),
  SSLCOMMERZ_STORE_PASSWORD: z.string().optional(),
  SSLCOMMERZ_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  GLOBAL_GATEWAY_PROVIDER: z
    .enum(['stub', 'paddle', 'lemonsqueezy', 'stripe'])
    .default('stub'),
  GLOBAL_GATEWAY_API_KEY: z.string().optional(),
  GLOBAL_GATEWAY_WEBHOOK_SECRET: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('motif Social <noreply@example.com>'),

  CRON_SECRET: z.string().min(1),
})

let cachedServer: z.infer<typeof serverSchema> | null = null

/** Server-only secrets. Throws if called where `process.env` is not populated. */
export function serverEnv() {
  if (cachedServer) return cachedServer
  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid server environment. Check: ${missing}`)
  }
  cachedServer = parsed.data
  return cachedServer
}

/** Origins permitted to call the app's own API routes. */
export function allowedOrigins(): string[] {
  return serverEnv()
    .ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}
