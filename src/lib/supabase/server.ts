import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Request-scoped client that carries the signed-in user.
 * Still subject to RLS — this is the client the gates run against, so that a
 * crafted API call is judged by the same policies as the UI.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to swallow.
          }
        },
      },
    },
  )
}
