import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Server client carrying the user's session. Still subject to RLS, which is
 * what we want: a route reading with this cannot accidentally read someone
 * else's run.
 *
 * `server-only` makes importing this from a client component a build error
 * rather than a silent leak of the service-role key into the browser bundle.
 */
export async function serverClient() {
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: middleware refreshes the session.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS, so it is only used where the route has
 * ALREADY established who is asking — never to decide whether they are allowed.
 */
export function serviceClient() {
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser() {
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
