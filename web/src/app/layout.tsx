import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Research Agent",
  description:
    "Research companies against an ICP and draft outreach for human review. Nothing is ever sent.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <div className="border-b border-[var(--border)]">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Lead Research Agent
            </Link>
            {/* Stated plainly and permanently: there is no send button anywhere
                in this application, and no tool exists that could add one. */}
            <span className="text-xs text-[var(--text-muted)]">Drafts only — nothing is sent</span>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
