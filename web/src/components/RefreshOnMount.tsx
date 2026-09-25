"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Forces one fresh server re-render the moment this page mounts, regardless
 * of how it was reached.
 *
 * `export const dynamic = "force-dynamic"` on a page only stops the SERVER
 * from caching it, the App Router's separate client-side Router Cache can
 * still serve a stale RSC payload after a `<Link>` navigation (a real case
 * here: clicking "See the leads" landed on a snapshot from before that run's
 * drafts existed, showing no Export button until a manual hard refresh).
 * `router.refresh()` re-requests this page's server data immediately,
 * closing that gap without waiting on the client cache's own staleness timer.
 */
export function RefreshOnMount() {
  const router = useRouter();

  useEffect(() => {
    router.refresh();
    // Deliberately once per mount, not on every `router` identity change,
    // this is a "make sure what I land on is fresh" nudge, not a live poll
    // (the leads page has no live status, unlike the run page's own polling).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
