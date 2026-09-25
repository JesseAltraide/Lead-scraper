import Link from "next/link";
import { redirect } from "next/navigation";
import { serverClient, getAuthState } from "@/lib/supabase-server";
import { RUN_STATES, isRunStatus, ACTIVE_STATUSES } from "@/lib/runStates";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { IntakeForm } from "@/components/IntakeForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, offline } = await getAuthState();
  // A dropped connection looks identical to "not signed in" (supabase-js
  // returns user: null either way) — say so instead of bouncing someone with
  // a perfectly valid session to sign-in.
  if (!user && offline) {
    return (
      <main className="mx-auto w-full max-w-4xl px-5 py-10">
        <EmptyState
          title="Can't reach the server"
          detail="This looks like a connection problem, not a sign-in issue. Check your internet connection and reload."
        />
      </main>
    );
  }
  if (!user) redirect("/sign-in");

  const supabase = await serverClient();
  const { data: runs } = await supabase
    .from("runs")
    .select("id, status, created_at, form")
    .order("created_at", { ascending: false })
    .limit(8);

  const all = runs ?? [];
  const activeRun = all.find((r) => isRunStatus(r.status) && ACTIVE_STATUSES.includes(r.status));
  // Narrowed once here, so the JSX below never has to cast.
  const active =
    activeRun && isRunStatus(activeRun.status)
      ? { id: activeRun.id, status: activeRun.status, spec: RUN_STATES[activeRun.status] }
      : null;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-5 py-10">
      {/* One active run per user. Rather than letting the form be filled in and
          rejected at the end, the refusal is shown up front with the way to
          resolve it. */}
      {active ? (
        <Card>
          <CardHeader
            title="You have a run in progress"
            meta={<Badge tone={active.spec.tone}>{active.spec.label}</Badge>}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <p className="text-sm text-[var(--text-muted)]">
              {active.spec.headline}. Only one run can be active at a time —
              the Apify budget is shared, so two at once is how one person&apos;s share becomes two.
            </p>
            <Link
              href={`/runs/${active.id}`}
              className="rounded-[8px] bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-[var(--accent-text)]"
            >
              Go to it
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <header>
            <h1 className="text-xl font-semibold tracking-tight">New research run</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
              Describe the companies you want. You&apos;ll confirm the criteria before anything is
              searched, and every draft it writes is for you to review — nothing is ever sent.
            </p>
          </header>
          <IntakeForm />
        </>
      )}

      {all.length > 0 ? (
        <Card>
          <CardHeader title="Earlier runs" />
          <ul className="divide-y divide-[var(--border)]">
            {all.map((r) => {
              const status = isRunStatus(r.status) ? r.status : null;
              const form = r.form as { industry?: string; geography?: string } | null;
              return (
                <li key={r.id}>
                  <Link
                    href={`/runs/${r.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--surface-2)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {[form?.industry, form?.geography].filter(Boolean).join(" · ") ||
                          "Untitled run"}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {new Date(r.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Badge tone={status ? RUN_STATES[status].tone : "neutral"}>
                      {status ? RUN_STATES[status].label : String(r.status)}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
