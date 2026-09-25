"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";
import { Card, CardHeader, Field, inputClass } from "@/components/ui";

/**
 * Landed on only via the recovery link Supabase itself emails (triggered by
 * resetPasswordForEmail on the sign-in page) — createBrowserClient reads the
 * recovery token out of the URL and establishes a session automatically, so
 * there is nothing for this page to parse itself. That session is scoped to
 * a password change: updateUser({ password }) is the only thing it is good
 * for, not general access to the account.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Those two don't match.");
      return;
    }

    setPending(true);
    const supabase = browserClient();
    const { error: authError } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (authError) {
      // Most likely: the recovery link was already used once, or has expired
      // — Supabase's own message names which, so it's passed through as-is
      // rather than replaced with something vaguer.
      setError(authError.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-20">
      <Card>
        <CardHeader title="Choose a new password" />
        <form className="space-y-4 px-5 py-5" onSubmit={submit}>
          <Field label="New password">
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className={inputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          {error ? (
            <p className="text-sm" style={{ color: "var(--error)" }} role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-[8px] bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-[var(--accent-text)] disabled:opacity-50"
          >
            {pending ? "Working…" : "Set new password"}
          </button>
        </form>
      </Card>
    </main>
  );
}
