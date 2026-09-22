import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Subject to Row Level Security, so it can only ever see the
 * signed-in user's own rows.
 *
 * Deliberately in its own file: the server helpers import `next/headers`, which
 * cannot be bundled for the browser. Keeping them together breaks the build the
 * moment a client component imports either one.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
