-- User B can neither see, change, delete nor reference user A's data.
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  b uuid := tests.new_user('b@example.invalid');
  plan_a uuid; plan_b uuid; n integer; t text;
begin
  -- A writes data across the modules
  perform tests.as_user(a);
  insert into public.profiles (display_name, timezone) values ('A', 'America/Sao_Paulo');
  insert into public.user_preferences default values;
  insert into public.training_plans (name) values ('plan A') returning id into plan_a;
  insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (plan_a, 1, null, 'user', 'initial');
  insert into public.daily_checkins (checkin_date, fatigue_score) values (date '2026-11-02', 3);
  insert into public.sleep_observations (night_date, duration_minutes) values (date '2026-11-02', 420);
  insert into public.completed_workouts (modality, started_at) values ('run', now());
  insert into public.meals (eaten_at, meal_type) values (now(), 'lunch');
  insert into public.scheduled_notifications (kind, run_at, payload, idempotency_key)
    values ('morning_checkin', now(), '{"kind":"morning_checkin","title":"x","body":"y"}', 'a-1');
  perform tests.reset();

  -- B sees nothing
  perform tests.as_user(b);
  foreach t in array array['profiles', 'user_preferences', 'training_plans', 'training_plan_versions', 'daily_checkins',
                           'sleep_observations', 'completed_workouts', 'meals', 'scheduled_notifications'] loop
    execute format('select count(*) from public.%I', t) into n;
    perform tests.assert(n = 0, 'B can see rows of A in ' || t);
  end loop;

  -- B cannot write as A (RLS WITH CHECK -> 42501)
  perform tests.throws(format('insert into public.profiles (user_id, display_name) values (%L, ''x'')', a), '42501', 'B inserts a profile for A');
  perform tests.throws(format('insert into public.daily_checkins (user_id, checkin_date, mood_score) values (%L, date ''2026-11-03'', 2)', a), '42501', 'B inserts a check-in for A');

  -- B cannot change or delete A's rows (they are invisible: 0 rows affected)
  update public.training_plans set name = 'hacked' where id = plan_a;
  get diagnostics n = row_count;
  perform tests.assert(n = 0, 'B updated A''s plan');
  delete from public.daily_checkins;
  get diagnostics n = row_count;
  perform tests.assert(n = 0, 'B deleted A''s check-ins');

  -- B cannot attach rows to A's plan: the composite FK (plan_id, user_id) rejects it
  perform tests.throws(format('insert into public.training_plan_versions (plan_id, version, parent_version, created_by_kind, reason) values (%L, 2, 1, ''user'', ''x'')', plan_a),
    '23503', 'B adds a version to A''s plan');
  perform tests.reset();

  -- A still has everything, untouched
  perform tests.as_user(a);
  select count(*) into n from public.training_plans where name = 'plan A';
  perform tests.assert(n = 1, 'A lost or saw a changed plan');
  select count(*) into n from public.daily_checkins;
  perform tests.assert(n = 1, 'A lost a check-in');
  perform tests.reset();

  -- Deleting the account removes every personal row (right to erasure)
  delete from auth.users where id = a;
  select (select count(*) from public.training_plans where user_id = a) + (select count(*) from public.daily_checkins where user_id = a)
       + (select count(*) from public.meals where user_id = a) + (select count(*) from public.profiles where user_id = a) into n;
  perform tests.assert(n = 0, 'personal data survived account deletion');
end
$$;
rollback;
