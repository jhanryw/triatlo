-- Migration 9 (additive): one ATOMIC operation to create a new plan version, apply a proposal and write the audit entry.
-- The REST API cannot run several statements in one transaction; this function does. It runs with the CALLER's rights
-- (security invoker), so RLS still applies for end users; the worker (service_role) can use it for automatic, approved changes.
--
-- Concurrency: p_expected_version must equal the current latest version (NULL/0 for the first one), otherwise it fails with
-- SQLSTATE 40001 and nothing is written. History is never rewritten: undoing is a NEW version with p_revert_of set.

create or replace function public.commit_plan_version(
  p_plan_id uuid,
  p_expected_version integer,
  p_reason text,
  p_actor_kind text,
  p_actor_ref text,
  p_proposal_id uuid,
  p_revert_of integer,
  p_sessions jsonb,
  p_audit jsonb
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_current integer;
  v_new integer;
  v_version_id uuid;
begin
  select user_id into v_user from public.training_plans where id = p_plan_id;            -- RLS: invisible plan = not found
  if v_user is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_sessions) is distinct from 'array' then
    raise exception 'p_sessions must be a JSON array' using errcode = '22023';
  end if;

  select max(version) into v_current from public.training_plan_versions where plan_id = p_plan_id;
  if coalesce(v_current, 0) <> coalesce(p_expected_version, 0) then
    raise exception 'stale plan version: expected %, current %', coalesce(p_expected_version, 0), coalesce(v_current, 0) using errcode = '40001';
  end if;
  v_new := coalesce(v_current, 0) + 1;

  insert into public.training_plan_versions (user_id, plan_id, version, parent_version, created_by_kind, created_by_ref, reason, proposal_id, revert_of)
  values (v_user, p_plan_id, v_new, v_current, p_actor_kind, p_actor_ref, p_reason, p_proposal_id, p_revert_of)
  returning id into v_version_id;

  insert into public.planned_workouts (user_id, plan_version_id, session_id, modality, objective, starts_at, duration_minutes, intensity, targets, instructions, status)
  select v_user, v_version_id, (e ->> 'session_id')::uuid, e ->> 'modality', e ->> 'objective', (e ->> 'starts_at')::timestamptz,
         (e ->> 'duration_minutes')::integer, nullif(e -> 'intensity', 'null'::jsonb), coalesce(nullif(e -> 'targets', 'null'::jsonb), '[]'::jsonb),
         e ->> 'instructions', coalesce(e ->> 'status', 'planned')
    from jsonb_array_elements(p_sessions) e;

  if p_proposal_id is not null then
    update public.workout_change_proposals
       set status = 'applied', applied_version = v_new, decided_at = coalesce(decided_at, pg_catalog.now())
     where id = p_proposal_id and plan_id = p_plan_id and status in ('proposed', 'approved');
    if not found then
      raise exception 'proposal % is not open on this plan', p_proposal_id using errcode = 'P0001';
    end if;
  end if;

  insert into public.adaptation_audit (user_id, actor_kind, actor_ref, action, plan_id, proposal_id, from_version, to_version, rule_ids, summary, details)
  values (v_user, coalesce(p_audit ->> 'actor_kind', p_actor_kind), coalesce(p_audit ->> 'actor_ref', p_actor_ref), p_audit ->> 'action',
          p_plan_id, p_proposal_id, v_current, v_new,
          coalesce(array(select jsonb_array_elements_text(coalesce(p_audit -> 'rule_ids', '[]'::jsonb))), '{}'),
          p_audit ->> 'summary', coalesce(p_audit -> 'details', '{}'::jsonb));

  return v_new;
end;
$$;

revoke all on function public.commit_plan_version(uuid, integer, text, text, text, uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.commit_plan_version(uuid, integer, text, text, text, uuid, integer, jsonb, jsonb) to authenticated, service_role;
