"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";
import { Card, CardHeader, Field, inputClass } from "@/components/ui";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const supabase = browserClient();
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
        <CardHeader title={mode === "sign-in" ? "Sign in" : "Create an account"} />
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
            {pending ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            className="w-full text-xs text-[var(--text-muted)] underline underline-offset-2"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setError(null);
            }}
          >
            {mode === "sign-in" ? "No account yet? Create one" : "Already have an account? Sign in"}
          </button>
        </form>
      </Card>
    </main>
  );
}
