import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
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
  const { user } = await getAuthState();
  return user;
}

/**
 * Same lookup as requireUser, but also reports whether a missing user is a
 * real "not signed in" versus this server failing to reach Supabase (e.g. no
 * internet). Both cases return user: null from supabase-js, so without this
 * a dropped connection looks identical to a logged-out visitor and sends
 * someone with a perfectly valid session back to sign-in. Page components
 * that redirect to /sign-in on no-user should check `offline` first.
 */
export async function getAuthState(): Promise<{ user: User | null; offline: boolean }> {
  const supabase = await serverClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (user) return { user, offline: false };

  // supabase-js reports a failed fetch (DNS, timeout, offline) as an
  // AuthRetryableFetchError with status 0 (see @supabase/auth-js's
  // fetch.js), not a real HTTP status and not undefined either — checking
  // for undefined here missed every actual offline case. A genuine "you're
  // not signed in" error (bad/expired session) always carries a real status
  // code (400, 401, ...).
  const status = (error as { status?: number } | null)?.status;
  const offline = Boolean(error) && (status === 0 || status === undefined);
  return { user: null, offline };
}
