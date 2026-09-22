import type { ReactNode } from "react";

/** Shared primitives, so every screen reads as the same application. */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] px-5 py-3.5">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {meta ? <div className="text-xs text-[var(--text-muted)]">{meta}</div> : null}
    </div>
  );
}

const TONE: Record<string, { fg: string; bg: string }> = {
  working: { fg: "var(--working)", bg: "var(--working-bg)" },
  waiting: { fg: "var(--waiting)", bg: "var(--waiting-bg)" },
  done: { fg: "var(--done)", bg: "var(--done-bg)" },
  partial: { fg: "var(--partial)", bg: "var(--partial-bg)" },
  error: { fg: "var(--error)", bg: "var(--error-bg)" },
  neutral: { fg: "var(--text-muted)", bg: "var(--surface-2)" },
};

export function Badge({
  children,
  tone = "neutral",
  live = false,
}: {
  children: ReactNode;
  tone?: keyof typeof TONE | string;
  live?: boolean;
}) {
  const t = TONE[tone] ?? TONE.neutral!;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color: t.fg, background: t.bg }}
    >
      {live ? (
        <span
          className="live-dot inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: t.fg }}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {hint ? <span className="mb-1.5 block text-xs text-[var(--text-muted)]">{hint}</span> : null}
      {children}
      {/* The message sits next to the field it belongs to, not in a summary at
          the top where the user has to work out which field it means. */}
      {error ? (
        <span className="mt-1.5 block text-xs" style={{ color: "var(--error)" }} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm " +
  "placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none";

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">{detail}</p>
    </div>
  );
}
