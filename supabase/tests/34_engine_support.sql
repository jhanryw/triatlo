-- Migration 8: availability, rule sets (immutable params, user-approved), AI call log, meal analyses, shared views.
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  b uuid := tests.new_user('b@example.invalid');
  plan_active uuid; plan_old uuid; v1 uuid; v2 uuid; meal1 uuid; meal2 uuid; rs uuid; call_id uuid; n integer; r record; q text;
begin
  perform tests.as_user(a);

  ---------------------------------------------------------------- availability windows
  perform tests.throws('insert into public.availability_windows (weekday, starts_at, ends_at, kind) values (7, ''06:00'', ''07:00'', ''training'')', '23514', 'weekday out of range');
  perform tests.throws('insert into public.availability_windows (weekday, starts_at, ends_at, kind) values (1, ''07:00'', ''06:00'', ''training'')', '23514', 'window ends before it starts');
  perform tests.throws('insert into public.availability_windows (weekday, starts_at, ends_at, kind) values (1, ''06:00'', ''07:00'', ''sleep'')', '23514', 'unknown window kind');
  insert into public.availability_windows (weekday, starts_at, ends_at, kind, label) values (1, '06:00', '07:00', 'training', 'before work');

  ---------------------------------------------------------------- rule sets: params immutable, approval is the user's act
  insert into public.training_rule_sets (version, params) values (1, '{"example":true}') returning id into rs;
  perform tests.throws('update public.training_rule_sets set params = ''{}''', '42501', 'edit rule-set parameters');
  perform tests.throws(format('update public.training_rule_sets set status = ''approved'' where id = %L', rs), '23514', 'approved without approved_at');
  update public.training_rule_sets set status = 'approved', approved_at = now() where id = rs;
  perform tests.throws('insert into public.training_rule_sets (version, params) values (1, ''{}'')', '23505', 'duplicate rule-set version');
  perform tests.throws('delete from public.training_rule_sets', '42501', 'delete a rule set');

  ---------------------------------------------------------------- AI call log: insert/select only, categories required
  perform tests.throws('insert into public.ai_calls (purpose, provider, status, data_categories) values (''meal_photo'', ''openai'', ''ok'', ''{}'')', '23514', 'AI call without data categories');
  insert into public.ai_calls (purpose, provider, model, status, input_tokens, output_tokens, data_categories)
    values ('meal_photo', 'openai', 'm', 'ok', 100, 50, array['meal_photo']) returning id into call_id;
  perform tests.throws('update public.ai_calls set status = ''error''', '42501', 'edit AI call log');
  perform tests.throws('delete from public.ai_calls', '42501', 'delete AI call log');

  ---------------------------------------------------------------- meals + analyses
  insert into public.meals (eaten_at, meal_type) values ('2026-11-03T02:30:00Z', 'dinner') returning id into meal1;   -- local 2026-11-02 23:30 in Sao Paulo
  insert into public.meals (eaten_at, meal_type) values ('2026-11-02T15:00:00Z', 'lunch') returning id into meal2;
  insert into public.meal_analyses (meal_id, status, provider, confidence, result, ai_call_id) values (meal1, 'succeeded', 'openai', 'medium', '{"items":[]}', call_id);
  perform tests.throws(format('update public.meal_analyses set status = ''reviewed'' where meal_id = %L', meal1), '23514', 'reviewed without reviewed_at');
  update public.meal_analyses set status = 'reviewed', reviewed_at = now() where meal_id = meal1;
  perform tests.throws('insert into public.meal_analyses (meal_id, confidence) values (gen_random_uuid(), ''high'')', '23503', 'analysis of a meal that does not exist');

  ---------------------------------------------------------------- current-plan view: latest version of ACTIVE plans only
  insert into public.training_plans (name) values ('active') returning id into plan_active;
  insert into public.training_plans (name, status) values ('old', 'archived') returning id into plan_old;
  insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (plan_active, 1, null, 'user', 'v1') returning id into v1;
  insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (plan_active, 2, 1, 'user', 'v2') returning id into v2;
  insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (plan_old, 1, null, 'user', 'old');
  insert into public.planned_workouts (plan_version_id, session_id, modality, starts_at, duration_minutes) values (v1, gen_random_uuid(), 'run', now(), 30);
  insert into public.planned_workouts (plan_version_id, session_id, modality, starts_at, duration_minutes) values (v2, gen_random_uuid(), 'swim', now(), 40), (v2, gen_random_uuid(), 'bike_indoor', now(), 50);
  insert into public.planned_workouts (plan_version_id, session_id, modality, starts_at, duration_minutes)
    select id, gen_random_uuid(), 'strength', now(), 20 from public.training_plan_versions where plan_id = plan_old;
  select count(*) into n from public.v_current_planned_workouts;
  perform tests.assert(n = 2, 'current plan view must show only the latest version of the active plan, got ' || n);
  select count(*) into n from public.v_current_planned_workouts where modality = 'run' or modality = 'strength';
  perform tests.assert(n = 0, 'old version / archived plan leaked into the current plan');

  ---------------------------------------------------------------- shared daily context (A has a timezone)
  perform tests.reset();
  insert into public.profiles (user_id, timezone) values (a, 'America/Sao_Paulo');
  perform tests.as_user(a);
  insert into public.daily_checkins (checkin_date, fatigue_score) values (date '2026-11-02', 4);
  insert into public.sleep_observations (night_date, duration_minutes, source) values (date '2026-11-02', 420, 'manual');
  insert into public.sleep_observations (night_date, duration_minutes, source, external_id) values (date '2026-11-02', 400, 'file_import', 'x1');
  insert into public.sleep_observations (night_date, subjective_quality) values (date '2026-11-03', 2);              -- duration unknown
  insert into public.sleep_observations (night_date, duration_minutes) values (date '2026-11-04', 0);               -- recorded zero
  insert into public.completed_workouts (modality, started_at, duration_minutes) values ('run', '2026-11-03T02:30:00Z', 45);   -- local 22:30 of 11-02
  insert into public.completed_workouts (modality, started_at) values ('swim', '2026-11-02T20:00:00Z');                 -- no duration
  insert into public.physiological_observations (metric, observed_at, value, unit, source) values ('resting_heart_rate', '2026-11-02T10:00:00Z', 55, 'bpm', 'manual');
  insert into public.physiological_observations (metric, observed_at, value, unit, source, external_id) values ('resting_heart_rate', '2026-11-02T11:00:00Z', 52, 'bpm', 'external_connector', 'r1');
  insert into public.nutrition_estimates (meal_id, energy_kcal, method, confidence) values (meal2, 600, 'ai', 'low');          -- meal-level estimate; meal1 has none

  select * into r from public.v_daily_context where day = date '2026-11-02';
  perform tests.assert(r.timezone_assumed is false, 'timezone must not be flagged when the profile has one');
  perform tests.assert(r.fatigue_score = 4 and r.checkin_quality = 'partial', 'check-in values/quality');
  perform tests.assert(r.sleep_minutes = 400 and r.sleep_source = 'file_import', 'sleep: imported source must win over manual, got ' || coalesce(r.sleep_minutes::text, 'null'));
  perform tests.assert(r.resting_heart_rate = 52, 'resting HR: connector source must win over manual');
  perform tests.assert(r.workout_count = 2, 'two workouts on local day 11-02 (one crosses UTC midnight), got ' || coalesce(r.workout_count::text, 'null'));
  perform tests.assert(r.workout_minutes = 45 and r.workouts_without_duration = 1, 'minutes must sum KNOWN durations only and count the unknown one');
  perform tests.assert(r.meals_logged = 2 and r.meals_with_estimate = 1 and r.energy_kcal_estimated = 600, 'intake: 2 meals, 1 with estimate, 600 kcal estimated');
  perform tests.assert(r.intake_recorded is true, 'intake_recorded');

  select * into r from public.v_daily_context where day = date '2026-11-03';
  perform tests.assert(r.sleep_minutes is null, 'unknown sleep duration must be NULL in the context, not 0');
  perform tests.assert(r.workout_count is null and r.meals_logged is null and r.intake_recorded is false, 'a day without workouts/meals must show NULLs and intake_recorded=false');
  select * into r from public.v_daily_context where day = date '2026-11-04';
  perform tests.assert(r.sleep_minutes = 0, 'a recorded zero must stay 0');
  select count(*) into n from public.v_daily_context where day = date '2026-11-05';
  perform tests.assert(n = 0, 'a day with no record at all must not appear');
  perform tests.reset();

  ---------------------------------------------------------------- isolation + assumed timezone
  perform tests.as_user(b);
  select count(*) into n from public.v_daily_context;
  perform tests.assert(n = 0, 'B sees A''s daily context');
  select count(*) into n from public.v_current_planned_workouts;
  perform tests.assert(n = 0, 'B sees A''s plan');
  select count(*) into n from public.training_rule_sets;
  perform tests.assert(n = 0, 'B sees A''s rule sets');
  insert into public.daily_checkins (checkin_date, mood_score) values (date '2026-11-02', 3);
  select timezone_assumed into q from (select timezone_assumed::text from public.v_daily_context limit 1) s;
  perform tests.assert(q = 'true', 'a user without timezone must be flagged as timezone_assumed');
  perform tests.reset();

  perform tests.as_anon();
  perform tests.throws('select * from public.v_daily_context', '42501', 'anon reads the daily context');
  perform tests.reset();
end
$$;
rollback;
