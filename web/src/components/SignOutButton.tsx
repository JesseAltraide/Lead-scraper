"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    const supabase = browserClient();
    await supabase.auth.signOut();
    // refresh() re-runs server components (the root layout's getAuthState())
    // against the now-cleared cookies, so the header updates in the same
    // navigation rather than showing stale "signed in" state until reload.
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={pending}
      className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
