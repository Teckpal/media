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

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

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

let cached: z.infer<typeof serverSchema> | null = null

/** Server-only secrets. Throws if called where `process.env` is not populated. */
export function serverEnv() {
  if (cached) return cached
  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid server environment. Check: ${missing}`)
  }
  cached = parsed.data
  return cached
}
