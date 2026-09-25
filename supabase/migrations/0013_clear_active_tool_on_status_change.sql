-- Found in a state-management review: `active_tool` (0010) is set/cleared by
-- wrapTool's own try/finally in agent/src/logging.ts, but if the whole agent
-- PROCESS dies mid-tool-call (not just a caught error, e.g. OOM-killed), that
-- finally block never runs and the column is left stuck on whatever tool was
-- in flight. Neither fail_run nor sweep_stalled_runs reset it, and neither
-- does re-claiming the run for a retry, so a run that failed while reading a
-- website, then got retried, could show a stale "reading a website" / Stop
-- disabled the moment status flips back to `researching`, until the agent's
-- own next tool call overwrites it. Self-healing within one tool call, not a
-- dead end, but a real visible glitch. Clear it at every point a run's status
-- changes away from (or back into) `researching`.

create or replace function claim_run_for_research(p_run_id uuid, p_worker text)
returns runs language plpgsql security definer as $$
declare r runs;
begin
  update runs
     set status = 'researching',
         claimed_at = now(),
         claimed_by = p_worker,
         heartbeat_at = now(),
         active_tool = null
   where id = p_run_id
     and status = 'icp_ready'      -- guard on state, not on time
     and icp is not null           -- discovery requires a finalised ICP right now
   returning * into r;

  if r.id is null then
    raise exception 'RUN_NOT_CLAIMABLE: run % is not in icp_ready with a finalised ICP', p_run_id
      using errcode = 'check_violation';
  end if;

  insert into run_events (run_id, kind, status_to, reason)
  values (p_run_id, 'status_change', 'researching', 'claimed by ' || p_worker);

  return r;
end $$;

create or replace function fail_run(p_run_id uuid, p_step text, p_reason text)
returns runs language plpgsql security definer as $$
declare r runs;
begin
  update runs
     set status = 'failed', failed_step = p_step, failure_reason = p_reason, active_tool = null
   where id = p_run_id and status = 'researching'
   returning * into r;

  if r.id is null then return null; end if;

  insert into run_events (run_id, kind, status_from, status_to, reason,
                          detail)
  values (p_run_id, 'failure', 'researching', 'failed', p_reason,
          jsonb_build_object('step', p_step));

  return r;
end $$;

create or replace function sweep_stalled_runs(p_stale_minutes int default 10)
returns setof runs language plpgsql security definer as $$
declare r runs;
begin
  -- Researching runs whose heartbeat stopped.
  for r in
    update runs
       set status = 'failed',
           failed_step = 'heartbeat',
           failure_reason = format('No progress reported for over %s minutes', p_stale_minutes),
           active_tool = null
     where status = 'researching'
       and heartbeat_at is not null
       and heartbeat_at < now() - make_interval(mins => p_stale_minutes)
    returning *
  loop
    insert into run_events (run_id, kind, status_from, status_to, reason)
    values (r.id, 'sweep_reclaim', 'researching', 'failed', r.failure_reason);
    return next r;
  end loop;

  -- Refining runs whose clarity check never came back.
  for r in
    update runs
       set status = 'cancelled',
           pending_questions = null,
           stopping_reason = format(
             'The check on your answers never finished (nothing happened for over %s minutes). Nothing was searched and nothing was spent, start a new search.',
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
