import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import { sessionScoped } from '@/lib/supabase/cookie-options'
import type { Database } from '@/types/database'

/**
 * Refreshes the auth cookie on every request and hands back both the user and
 * the response carrying the updated cookies. The caller must return *that*
 * response (or copy its cookies) or the refreshed session is lost.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, sessionScoped(options))
          }
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user, supabase }
}
