-- commit_plan_version: atomic versioning + proposal application + audit; stale detection; tenant isolation.
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  b uuid := tests.new_user('b@example.invalid');
  plan uuid; prop uuid; s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); v integer; n integer; r record;
  sessions jsonb;
begin
  perform tests.as_user(a);
  insert into public.training_plans (name) values ('p') returning id into plan;
  sessions := jsonb_build_array(
    jsonb_build_object('session_id', s1, 'modality', 'run', 'starts_at', '2026-11-03T18:00:00Z', 'duration_minutes', 60, 'intensity', null, 'targets', '[]'::jsonb),
    jsonb_build_object('session_id', s2, 'modality', 'swim', 'starts_at', '2026-11-04T18:00:00Z', 'duration_minutes', 40));

  -- first version (expected NULL), then a second one (expected 1)
  select public.commit_plan_version(plan, null, 'initial', 'user', null, null, null, sessions, jsonb_build_object('action', 'plan_created', 'summary', 'created')) into v;
  perform tests.assert(v = 1, 'first version must be 1');
  select count(*) into n from public.planned_workouts where plan_version_id = (select id from public.training_plan_versions where plan_id = plan and version = 1);
  perform tests.assert(n = 2, 'sessions are snapshotted per version');

  -- stale expected version: nothing written
  perform tests.throws(format('select public.commit_plan_version(%L, 0, ''x'', ''user'', null, null, null, ''[]''::jsonb, ''{"action":"plan_created","summary":"s"}''::jsonb)', plan), '40001', 'stale commit must fail');
  select count(*) into n from public.training_plan_versions where plan_id = plan;
  perform tests.assert(n = 1, 'a failed commit must write nothing');
  perform tests.throws(format('select public.commit_plan_version(%L, 1, ''x'', ''user'', null, null, null, ''{}''::jsonb, ''{"action":"plan_created","summary":"s"}''::jsonb)', plan), '22023', 'sessions must be an array');

  -- proposal applied atomically with the new version and an audit row
  insert into public.workout_change_proposals (plan_id, base_version, change_class, trigger_type, changes, rationale, status)
    values (plan, 1, 'auto_safe', 'daily', '[{"type":"update_session"}]', '{"summary":"s","dataQuality":"partial"}', 'proposed') returning id into prop;
  sessions := jsonb_build_array(
    jsonb_build_object('session_id', s1, 'modality', 'run', 'starts_at', '2026-11-03T18:00:00Z', 'duration_minutes', 48),
    jsonb_build_object('session_id', s2, 'modality', 'swim', 'starts_at', '2026-11-04T18:00:00Z', 'duration_minutes', 40));
  select public.commit_plan_version(plan, 1, 'reduced', 'engine', 'rules-v1', prop, null, sessions,
    jsonb_build_object('action', 'plan_version_applied', 'summary', 'reduced', 'rule_ids', jsonb_build_array('r1'), 'details', jsonb_build_object('k', 1))) into v;
  perform tests.assert(v = 2, 'second version must be 2');
  select status, applied_version into r from public.workout_change_proposals where id = prop;
  perform tests.assert(r.status = 'applied' and r.applied_version = 2, 'proposal must be marked applied with the new version');
  select * into r from public.adaptation_audit where plan_id = plan and to_version = 2;
  perform tests.assert(r.action = 'plan_version_applied' and r.from_version = 1 and r.proposal_id = prop and r.rule_ids = array['r1'] and r.actor_kind = 'engine', 'audit row content');
  select count(*) into n from public.v_current_planned_workouts where plan_version = 2 and duration_minutes = 48;
  perform tests.assert(n = 1, 'current-plan view must show version 2 with the reduced session');

  -- an already-applied proposal cannot be applied again (atomic: no version leaks)
  perform tests.throws(format('select public.commit_plan_version(%L, 2, ''again'', ''engine'', null, %L, null, ''[]''::jsonb, ''{"action":"plan_version_applied","summary":"s"}''::jsonb)', plan, prop), 'P0001', 'proposal applied twice');
  select count(*) into n from public.training_plan_versions where plan_id = plan;
  perform tests.assert(n = 2, 'the failed second application must not leave a version behind');

  -- undo = NEW version restoring content, revert_of set
  select public.commit_plan_version(plan, 2, 'undo', 'user', null, null, 1,
    (select jsonb_agg(jsonb_build_object('session_id', session_id, 'modality', modality, 'starts_at', starts_at, 'duration_minutes', duration_minutes))
       from public.planned_workouts where plan_version_id = (select id from public.training_plan_versions where plan_id = plan and version = 1)),
    jsonb_build_object('action', 'plan_reverted', 'summary', 'undo')) into v;
  select revert_of into n from public.training_plan_versions where plan_id = plan and version = v;
  perform tests.assert(v = 3 and n = 1, 'revert creates version 3 with revert_of = 1');
  perform tests.reset();

  -- tenant isolation and anon
  perform tests.as_user(b);
  perform tests.throws(format('select public.commit_plan_version(%L, 3, ''x'', ''user'', null, null, null, ''[]''::jsonb, ''{"action":"plan_created","summary":"s"}''::jsonb)', plan), 'P0002', 'B commits to A''s plan');
  perform tests.reset();
  perform tests.as_anon();
  perform tests.throws(format('select public.commit_plan_version(%L, 3, ''x'', ''user'', null, null, null, ''[]''::jsonb, ''{}''::jsonb)', plan), '42501', 'anon executes commit');
  perform tests.reset();

  -- the worker (service_role) can commit on behalf of the plan owner
  perform tests.as_service();
  select public.commit_plan_version(plan, 3, 'auto', 'engine', 'rules-v1', null, null, '[]'::jsonb, jsonb_build_object('action', 'plan_version_applied', 'summary', 'auto')) into v;
  perform tests.assert(v = 4, 'service role can commit for the owner');
  select user_id into r from public.training_plan_versions where plan_id = plan and version = 4;
  perform tests.assert(r.user_id = a, 'version must belong to the plan owner, not to the caller');
  perform tests.reset();
end
$$;
rollback;
