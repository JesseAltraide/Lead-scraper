-- ---------------------------------------------------------------------------
-- Claim generation fencing.
--
-- Real bug this closes: stop_run (web) flips a run's status the instant the
-- user clicks Stop, but the actual agent process on Render only notices on
-- its next poll (runAgent.ts's stopWatcher, every 5s) and aborts itself
-- then. If the user clicks "Continue from where it stopped" inside that
-- window, a SECOND runAgent() process claims the same run and flips status
-- back to 'researching' -- which means the FIRST process's next poll sees
-- status = 'researching' again and wrongly concludes nothing changed. Two
-- live processes then call discover_companies/screen_candidates/
-- scrape_website concurrently for the same run: duplicate Apify spend and a
-- real risk of racing writes on the same candidate/lead rows.
--
-- claim_generation is a fencing token: it increments every time a run is
-- (re)claimed for research. A process captures its own generation once, at
-- claim time, and every subsequent tool-call budget check (which already
-- runs on EVERY tool call, see claim_tool_call_budget) also verifies the
-- row's CURRENT generation still matches. A superseded process's tool calls
-- start failing immediately, even during a window where the status column
-- alone would look unchanged to it.
-- ---------------------------------------------------------------------------

alter table runs add column if not exists claim_generation integer not null default 0;

create or replace function claim_run_for_research(p_run_id uuid, p_worker text)
returns runs language plpgsql security definer as $$
declare r runs;
begin
  update runs
     set status = 'researching',
         claimed_at = now(),
         claimed_by = p_worker,
         heartbeat_at = now(),
         claim_generation = claim_generation + 1
   where id = p_run_id
     and status = 'icp_ready'
     and icp is not null
   returning * into r;

  if r.id is null then
    raise exception 'RUN_NOT_CLAIMABLE: run % is not in icp_ready with a finalised ICP', p_run_id
      using errcode = 'check_violation';
  end if;

  insert into run_events (run_id, kind, status_to, reason)
  values (p_run_id, 'status_change', 'researching', 'claimed by ' || p_worker);

  return r;
end $$;

create or replace function claim_tool_call_budget(p_run_id uuid, p_generation integer)
returns jsonb language plpgsql security definer as $$
declare used int; cap int; current_generation int;
begin
  update runs
     set tool_calls_used = tool_calls_used + 1
   where id = p_run_id
     and status = 'researching'
     and tool_calls_used < max_tool_calls
     and claim_generation = p_generation
   returning tool_calls_used, max_tool_calls into used, cap;

  if used is null then
    select tool_calls_used, max_tool_calls, status, claim_generation into used, cap, current_generation
      from runs where id = p_run_id;
    if used is null then
      raise exception 'RUN_NOT_FOUND: %', p_run_id using errcode = 'check_violation';
    end if;
    if current_generation is distinct from p_generation then
      raise exception 'RUN_SUPERSEDED: run % was reclaimed by a newer process (generation % != %)',
        p_run_id, current_generation, p_generation using errcode = 'check_violation';
    end if;
    raise exception 'TOOL_CALL_CAP_REACHED: %/% tool calls used, or run is not researching', used, cap
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object('used', used, 'cap', cap);
end $$;
