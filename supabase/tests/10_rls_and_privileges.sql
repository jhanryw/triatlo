-- Every public table has RLS, anon has no access to anything, internal queue is invisible to users.
begin;
do $$
declare
  t text;
  missing text;
  expected text[] := array['profiles', 'user_preferences', 'data_import_provenance', 'training_plans', 'training_plan_versions',
    'planned_workouts', 'completed_workouts', 'workout_change_proposals', 'user_approvals', 'adaptation_audit',
    'daily_checkins', 'sleep_observations', 'physiological_observations', 'meals', 'meal_items', 'nutrition_estimates',
    'push_subscriptions', 'scheduled_notifications', 'background_jobs',
    'availability_windows', 'training_rule_sets', 'ai_calls', 'meal_analyses'];
begin
  -- 1. CI guard: any table in public WITHOUT row level security fails the build
  select string_agg(c.relname, ', ') into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  perform tests.assert(missing is null, 'tables without RLS: ' || coalesce(missing, ''));

  -- 2. all expected tables exist
  foreach t in array expected loop
    perform tests.assert(to_regclass('public.' || t) is not null, 'missing table ' || t);
    perform tests.assert(not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete'), 'anon must have no privileges on ' || t);
    perform tests.assert(not has_table_privilege('anon', 'public.' || t, 'select'), 'anon can select ' || t);
  end loop;

  -- 3. the queue is invisible and untouchable for end users
  perform tests.assert(not has_table_privilege('authenticated', 'public.background_jobs', 'select'), 'authenticated can select background_jobs');
  perform tests.assert(not has_table_privilege('authenticated', 'public.background_jobs', 'insert'), 'authenticated can insert background_jobs');
  perform tests.assert(has_table_privilege('service_role', 'public.background_jobs', 'select'), 'service_role must reach background_jobs');

  -- 4. queue functions: service_role only
  foreach t in array array['public.claim_background_jobs(text,integer,integer)', 'public.complete_background_job(uuid,text)',
    'public.fail_background_job(uuid,text,text,integer)', 'public.supersede_background_jobs(uuid,text)',
    'public.enqueue_background_job(text,uuid,timestamptz,text,text,jsonb,integer)'] loop
    perform tests.assert(not has_function_privilege('anon', t, 'execute'), 'anon can execute ' || t);
    perform tests.assert(not has_function_privilege('authenticated', t, 'execute'), 'authenticated can execute ' || t);
    perform tests.assert(has_function_privilege('service_role', t, 'execute'), 'service_role cannot execute ' || t);
  end loop;

  -- 4b. views: authenticated only, and they run with the CALLER's rights (security_invoker) so RLS applies
  foreach t in array array['v_daily_context', 'v_current_planned_workouts'] loop
    perform tests.assert(not has_table_privilege('anon', 'public.' || t, 'select'), 'anon can select view ' || t);
    perform tests.assert(has_table_privilege('authenticated', 'public.' || t, 'select'), 'authenticated cannot select view ' || t);
    perform tests.assert((select coalesce(reloptions::text, '') like '%security_invoker=true%' from pg_class where oid = ('public.' || t)::regclass), 'view ' || t || ' must be security_invoker');
  end loop;

  -- 5. anon is rejected at runtime too
  perform tests.as_anon();
  perform tests.throws('select * from public.profiles', '42501', 'anon select profiles');
  perform tests.throws('select * from public.daily_checkins', '42501', 'anon select daily_checkins');
  perform tests.reset();
end
$$;
rollback;
