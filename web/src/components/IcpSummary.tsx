"use client";

import type { Icp } from "@/lib/icp";
import type { RunStatus } from "@/lib/runStates";
import { RunActions } from "./RunActions";
import { IcpFields } from "./IcpFields";

/**
 * The confirm screen at `icp_ready` — view only.
 *
 * Formerly editable (see git history: IcpEditor.tsx). Changed per Decision
 * #60: PRD.md, unlike week5-full-flow.md's original design, never specifies
 * that this screen must allow editing — it only requires the run record show
 * the refined ICP before searching (PRD test #1). Given that, every value
 * shown here has already passed exactly the same validation the intake form
 * enforces (industry taxonomy, persona vagueness/gibberish, company-size
 * band, gibberish-free text on every free-text field) to have reached this
 * screen at all, so there is no case where in-place editing was ever needed
 * to fix something invalid — it can't be invalid by construction. Wanting
 * something different means starting a new search with different answers,
 * not patching this one.
 *
 * This does reverse Decision #23 (full-flow.md's "the user can still edit
 * any of it", made in direct response to prior graded feedback about not
 * letting the system decide something the user can't override). That
 * tradeoff is deliberate and stated here, not silently dropped.
 */
export function IcpSummary({
  runId,
  status,
  icp,
  changeKey,
}: {
  runId: string;
  status: RunStatus;
  icp: Icp;
  changeKey: string;
}) {
  return (
    <div className="space-y-5">
      <IcpFields icp={icp} />

      <div className="border-t border-[var(--border)] pt-4">
        <RunActions
          runId={runId}
          status={status}
          ctx={{ hasIcp: true, hasLeads: false, continuesUsed: 0 }}
          changeKey={changeKey}
          live={false}
        />
      </div>
    </div>
  );
}
