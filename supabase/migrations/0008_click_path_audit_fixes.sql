-- Three fixes from the click-path audit (week5-progress.md Errors & Fixes
-- #10, #11, #12). All three are the same underlying shape: a claim or a live
-- status that nothing could ever release if the process holding it went away.

-- ---------------------------------------------------------------------------
-- CLICK-PATH-001 — a run stuck at `refining` had no recovery of any kind.
--
-- `runClarityCheck` is awaited INSIDE the HTTP request that creates a run or
-- answers a clarifying question. If that request dies outright (serverless
-- timeout, deploy, crash), no catch block runs and the run stays at `refining`
-- forever. The sweep was the designed backstop for exactly this class of
-- failure — but it only ever matched `status = 'researching' AND heartbeat_at
-- IS NOT NULL`, and a `refining` run has no heartbeat and isn't researching,
-- so it was never swept. `refining` offers only Cancel, so the user was not
-- hard-trapped, but nothing ever resolved or explained the stall.
--
-- A stalled refining run is landed on `cancelled` rather than `icp_ready`,
-- because it may never have had an ICP written — and per the RunContext logic
-- in runStates.ts, a cancelled run with no ICP and no leads resolves to
-- exactly one action: "Start a new search". Same honest shape as
-- giveUpAfterMaxRounds.
--
-- `updated_at` is safe to key on: the `runs_touch` trigger (0001_init.sql)
-- maintains it on every update, and a run that enters `refining` and never
-- comes back is never touched again. A real clarity check takes seconds, so
-- the default 10-minute window cannot catch a legitimately-running one.
-- ---------------------------------------------------------------------------

create or replace function sweep_stalled_runs(p_stale_minutes int default 10)
returns setof runs language plpgsql security definer as $$
declare r runs;
begin
  -- Unchanged: researching runs whose heartbeat stopped.
  for r in
    update runs
       set status = 'failed',
           failed_step = 'heartbeat',
           failure_reason = format('No progress reported for over %s minutes', p_stale_minutes)
     where status = 'researching'
       and heartbeat_at is not null
       and heartbeat_at < now() - make_interval(mins => p_stale_minutes)
    returning *
  loop
    insert into run_events (run_id, kind, status_from, status_to, reason)
    values (r.id, 'sweep_reclaim', 'researching', 'failed', r.failure_reason);
    return next r;
  end loop;

  -- New: refining runs whose clarity check never came back.
  for r in
    update runs
       set status = 'cancelled',
           pending_questions = null,
           stopping_reason = format(
             'The check on your answers never finished (nothing happened for over %s minutes). Nothing was searched and nothing was spent — start a new search.',
             p_stale_minutes)
     where status = 'refining'
       and updated_at < now() - make_interval(mins => p_stale_minutes)
    returning *
  loop
    insert into run_events (run_id, kind, status_from, status_to, reason)
    values (r.id, 'sweep_reclaim', 'refining', 'cancelled', r.stopping_reason);
    return next r;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CLICK-PATH-002 — re-choosing the version that was ALREADY chosen silently
-- wiped its `reviewed` mark.
--
-- The rule is "reviewed belongs to a specific version, so choosing a different
-- one resets it to unreviewed" — correct, and still enforced below. But the
-- reset was applied unconditionally, and the review screen's version dropdown
-- chooses a version the moment you look at it. So: mark v2 reviewed, glance at
-- v1, come back to v2 — and the sign-off is gone, with no way to browse
-- without choosing. That destroys the human-review attestation this whole
-- phase exists to capture.
--
-- Now `reviewed` is preserved only when the target was already the chosen
-- version (i.e. the content in front of the reviewer did not change). Any
-- genuine switch still resets it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A rewrite slot could be stranded in-flight FOREVER.
--
-- `claim_rewrite_slot` sets rewrite_in_flight = true before the paid call, and
-- `release_rewrite_slot` clears it afterwards — but only if the process lives
-- long enough to call it. If it dies mid-rewrite (deploy, crash, serverless
-- kill), the flag stays true and `rewrite_in_flight = false` in the claim's
-- WHERE means that piece can NEVER be rewritten again. The button disables and
-- the guard refuses, permanently, with no way back.
--
-- `claim_scrape_budget` already solved exactly this for scrapes (0003), with a
-- claimed-at timestamp and a ten-minute reclaim window. Same fix, same shape.
--
-- Reclaiming does NOT consume an extra slot: the attempt that died never
-- called release_rewrite_slot(succeeded => false), so its increment was never
-- refunded. Treating it as failed — the refund it should have had — is what
-- keeps "counts rewrites actually requested" honest, and is why the reclaim
-- branch holds rewrites_requested steady (refund the dead one, charge the new
-- one) rather than incrementing. It is also why a stale claim can be reclaimed
-- at the cap: 3-requested-with-one-dead is really only 2 spent.
-- ---------------------------------------------------------------------------

alter table draft_pieces add column if not exists rewrite_claimed_at timestamptz;

-- Any slot still flagged in-flight when this migration runs is stranded by
-- definition — no rewrite survives a deploy. Release them exactly as
-- release_rewrite_slot(succeeded => false) would have.
update draft_pieces
   set rewrite_in_flight = false,
       rewrites_requested = greatest(rewrites_requested - 1, 0)
 where rewrite_in_flight;

create or replace function claim_rewrite_slot(p_lead_id uuid, p_piece_key draft_piece_key)
returns draft_pieces language plpgsql security definer as $$
declare piece draft_pieces;
begin
  insert into draft_pieces (lead_id, piece_key) values (p_lead_id, p_piece_key)
  on conflict (lead_id, piece_key) do update set lead_id = excluded.lead_id;

  update draft_pieces
     set rewrites_requested = case
           -- Stale reclaim: refund the dead attempt, charge this one. Net zero.
           when rewrite_in_flight then rewrites_requested
           else rewrites_requested + 1
         end,
         rewrite_in_flight = true,
         rewrite_claimed_at = now()
   where lead_id = p_lead_id
     and piece_key = p_piece_key
     and (
       -- Normal claim: nothing in flight and the cap has room.
       (rewrite_in_flight = false and rewrites_requested < 3)
       -- Or a claim old enough that whatever made it is gone.
       or (rewrite_in_flight = true
           and rewrite_claimed_at is not null
           and rewrite_claimed_at < now() - interval '10 minutes')
     )
   returning * into piece;

  if piece.id is null then
    raise exception 'REWRITE_UNAVAILABLE: cap reached, or a rewrite is already in flight'
      using errcode = 'check_violation';
  end if;

  return piece;
end $$;

-- ---------------------------------------------------------------------------
-- CLICK-PATH-002 (continued)
-- ---------------------------------------------------------------------------

create or replace function choose_draft_version(p_version_id uuid)
returns draft_versions language plpgsql security definer as $$
declare v draft_versions; p uuid; was_chosen boolean;
begin
  -- Captured BEFORE the clear-then-set below, which would otherwise erase the
  -- very fact we need to test.
  select piece_id, is_chosen into p, was_chosen
    from draft_versions where id = p_version_id;

  if p is null then
    raise exception 'VERSION_NOT_FOUND: %', p_version_id using errcode = 'check_violation';
  end if;

  update draft_versions set is_chosen = false where piece_id = p and is_chosen;

  update draft_versions
     set is_chosen = true,
         reviewed = case when was_chosen then reviewed else false end
   where id = p_version_id
  returning * into v;

  return v;
end $$;
