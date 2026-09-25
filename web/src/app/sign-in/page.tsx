"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";
import { Card, CardHeader, Field, inputClass } from "@/components/ui";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot">("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const supabase = browserClient();

    if (mode === "forgot") {
      // Supabase's own reset email, not a page we build or send ourselves —
      // it emails a one-time recovery link that lands on /reset-password
      // with a Supabase-issued session, which is the only thing allowed to
      // set a new password there.
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setPending(false);
      if (authError) {
        setError(authError.message);
        return;
      }
      // Deliberately the same message whether or not the address has an
      // account — confirming which emails are registered is its own small
      // leak, and Supabase's own behavior here already doesn't distinguish.
      setNotice("If an account exists for that email, a reset link is on its way.");
      return;
    }

    const { error: authError, data } =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setPending(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    // Sign-up with email confirmation on returns a user but no session.
    if (!data.session) {
      setNotice("Check your email to confirm the account, then sign in.");
      setMode("sign-in");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-20">
      <Card>
        <CardHeader
          title={mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create an account" : "Reset your password"}
        />
        <form className="space-y-4 px-5 py-5" onSubmit={submit}>
          <Field label="Email">
            <input
              type="email"
              required
              autoComplete="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {mode !== "forgot" ? (
            <Field label="Password">
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          ) : null}

          {error ? (
            <p className="text-sm" style={{ color: "var(--error)" }} role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className="text-sm text-[var(--text-muted)]">{notice}</p> : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-[8px] bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-[var(--accent-text)] disabled:opacity-50"
          >
            {pending
              ? "Working…"
              : mode === "sign-in"
                ? "Sign in"
                : mode === "sign-up"
                  ? "Create account"
                  : "Send reset link"}
          </button>

          {mode === "sign-in" ? (
            <button
              type="button"
              className="w-full text-xs text-[var(--text-muted)] underline underline-offset-2"
              onClick={() => {
                setMode("forgot");
                setError(null);
                setNotice(null);
              }}
            >
              Forgot your password?
            </button>
          ) : null}

          <button
            type="button"
            className="w-full text-xs text-[var(--text-muted)] underline underline-offset-2"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "sign-in"
              ? "No account yet? Create one"
              : "Already have an account? Sign in"}
          </button>
        </form>
      </Card>
    </main>
  );
}
