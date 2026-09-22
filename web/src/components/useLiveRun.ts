"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The ONE place the app refreshes itself. Every screen that needs to update
 * uses this — there is no second mechanism.
 *
 * Why it is written this way: `router.refresh()` is a request to re-render the
 * server components, and it can silently do nothing — a failed fetch, a
 * discarded render, a navigation that races it. In a prior build it silently
 * failed three separate times before anyone noticed, because nothing on screen
 * ever claimed to know whether it had worked.
 *
 * So this helper does not trust the refresh. It records when data was last
 * *observed to change* and exposes that. If refreshes stop landing, the screen
 * says so instead of sitting there looking live.
 */

export type PollState = {
  /** Seconds since the last refresh that actually produced new data. */
  staleSeconds: number;
  /** True once refreshes have stopped landing for long enough to be worth saying. */
  stalled: boolean;
  /** Force a refresh now (used by action buttons after a successful POST). */
  refreshNow: () => void;
};

const POLL_MS = 3000;
/** Treated as a dead poll after this long with no observed change. */
const STALL_AFTER_MS = 30_000;

export function useLiveRun(options: {
  /** Poll only while the run is in a live state. */
  enabled: boolean;
  /**
   * A value that changes whenever the underlying data changes — the run's
   * `updated_at` plus row counts. Used to detect that a refresh actually
   * landed, rather than assuming it did.
   */
  changeKey: string;
}): PollState {
  const router = useRouter();
  const [lastChangeAt, setLastChangeAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const seenKey = useRef(options.changeKey);

  // A refresh landed and the data really is different.
  useEffect(() => {
    if (seenKey.current !== options.changeKey) {
      seenKey.current = options.changeKey;
      setLastChangeAt(Date.now());
    }
  }, [options.changeKey]);

  const refreshNow = useCallback(() => {
    router.refresh();
  }, [router]);

  // Polling is the guarantee. Anything faster would be an accelerator on top,
  // never the thing correctness depends on — a socket can report "connected"
  // and still deliver nothing.
  useEffect(() => {
    if (!options.enabled) return;
    const poll = setInterval(() => router.refresh(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [options.enabled, router]);

  const elapsed = now - lastChangeAt;

  return {
    staleSeconds: Math.floor(elapsed / 1000),
    // A run can legitimately be quiet for a while (a slow scrape), so this is
    // phrased on screen as "no update for N seconds" — an honest observation,
    // not a claim that the run has failed.
    stalled: options.enabled && elapsed > STALL_AFTER_MS,
    refreshNow,
  };
}
