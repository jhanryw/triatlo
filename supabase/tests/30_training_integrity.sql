-- Training domain integrity: preferences rule, immutable versions, proposal lifecycle, approvals, audit, no invented defaults.
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  b uuid := tests.new_user('b@example.invalid');
  plan_a uuid; proposal_a uuid; q text; n integer; v numeric;
begin
  perform tests.as_user(a);

  ---------------------------------------------------------------- preferences mirror the domain autonomy rule
  insert into public.user_preferences default values;
  perform tests.throws('update public.user_preferences set auto_apply_enabled = true', '23514', 'auto apply without approved limits');
  update public.user_preferences set auto_apply_enabled = true, approved_limits_version = 'v1';
  perform tests.throws('update public.user_preferences set approved_limits_version = null', '23514', 'dropping limits while auto apply is on');

  ---------------------------------------------------------------- plans are immutable, proposals only move through their lifecycle
  insert into public.training_plans (name) values ('p') returning id into plan_a;
  insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (plan_a, 1, null, 'user', 'initial');
  perform tests.throws(format('insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (%L, 3, 2, ''user'', ''gap'')', plan_a), '23503', 'version 3 whose parent v2 does not exist');
  perform tests.throws(format('insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (%L, 3, 1, ''user'', ''skip'')', plan_a), '23514', 'parent must be the previous version');
  perform tests.throws(format('insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (%L, 2, null, ''user'', ''orphan'')', plan_a), '23514', 'only version 1 may have no parent');
  perform tests.throws('update public.training_plan_versions set reason = ''edited''', '42501', 'update immutable version');
  perform tests.throws('delete from public.training_plan_versions', '42501', 'delete immutable version');

  insert into public.workout_change_proposals (plan_id, base_version, change_class, trigger_type, changes, rationale)
    values (plan_a, 1, 'needs_approval', 'event', '[{"type":"cancel_session","sessionId":"x"}]', '{"summary":"s","dataQuality":"partial"}')
    returning id into proposal_a;
  perform tests.throws('insert into public.workout_change_proposals (plan_id, base_version, change_class, trigger_type, changes, rationale) values (null, 1, ''auto_safe'', ''event'', ''[]'', ''{}'')', '23502', 'proposal needs a plan');
  perform tests.throws(format('update public.workout_change_proposals set changes = ''[]'' where id = %L', proposal_a), '42501', 'rewrite proposal content');
  perform tests.throws(format('update public.workout_change_proposals set status = ''applied'' where id = %L', proposal_a), '23514', 'applied without applied_version');
  update public.workout_change_proposals set status = 'approved', decided_at = now() where id = proposal_a;
  update public.workout_change_proposals set status = 'applied', applied_version = 2 where id = proposal_a;

  insert into public.user_approvals (proposal_id, decision) values (proposal_a, 'approved');
  perform tests.throws(format('insert into public.user_approvals (proposal_id, decision) values (%L, ''rejected'')', proposal_a), '23505', 'second decision for the same proposal');
  perform tests.throws('update public.user_approvals set decision = ''rejected''', '42501', 'edit an approval');
  insert into public.adaptation_audit (actor_kind, action, summary) values ('engine', 'plan_version_applied', 'applied');
  perform tests.throws('update public.adaptation_audit set summary = ''x''', '42501', 'edit audit');
  perform tests.throws('delete from public.adaptation_audit', '42501', 'delete audit');
  perform tests.throws('insert into public.adaptation_audit (actor_kind, action, summary) values (''engine'', ''do_anything'', ''x'')', '23514', 'unknown audit action');

  ---------------------------------------------------------------- planned workouts: no invented defaults, opaque intensity
  perform tests.throws(format('insert into public.planned_workouts (plan_version_id, session_id, modality, starts_at, duration_minutes) select id, gen_random_uuid(), ''run'', now(), 0 from public.training_plan_versions where plan_id = %L', plan_a), '23514', 'zero duration planned workout');
  perform tests.throws(format('insert into public.planned_workouts (plan_version_id, session_id, modality, starts_at, duration_minutes, intensity) select id, gen_random_uuid(), ''run'', now(), 30, ''{"zone":3}'' from public.training_plan_versions where plan_id = %L', plan_a), '23514', 'intensity must be {scale,value}');
  insert into public.planned_workouts (plan_version_id, session_id, modality, starts_at, duration_minutes)
    select id, gen_random_uuid(), 'swim', now(), 30 from public.training_plan_versions where plan_id = plan_a;
  select count(*) into n from public.planned_workouts where status = 'planned' and intensity is null and targets = '[]'::jsonb;
  perform tests.assert(n = 1, 'planned workout got an invented default');
end
$$;
rollback;
