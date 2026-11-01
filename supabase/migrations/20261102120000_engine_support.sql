-- Migration 8 (additive): availability windows, rule sets, AI call log, meal analyses and the shared daily-context view.
-- No existing object is altered or dropped. Same conventions as before: user_id + composite FKs, RLS on every table,
-- explicit revokes/grants, absent vs partial vs zero kept distinct. No physiological threshold is hard-coded here: policy
-- parameters live in `training_rule_sets.params`, are versioned, and only take effect after the USER approves them.

-- Weekly availability (local wall-clock times; the user's timezone lives in profiles). Used to PLACE sessions, never to judge.
create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekday smallint not null,
  starts_at time not null,
  ends_at time not null,
  kind text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint availability_windows_weekday_check check (weekday between 0 and 6),
  constraint availability_windows_period_check check (ends_at > starts_at),
  constraint availability_windows_kind_check check (kind in ('training', 'work', 'commute', 'meal', 'blocked'))
);

-- Versioned policy parameters for the adaptation engine. Immutable once created (new version = new row). Approval is the
-- user's explicit act: status moves draft -> approved|retired, nothing else is editable.
create table public.training_rule_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version integer not null,
  status text not null default 'draft',
  params jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (id, user_id),
  unique (user_id, version),
  constraint training_rule_sets_version_check check (version >= 1),
  constraint training_rule_sets_status_check check (status in ('draft', 'approved', 'retired')),
  constraint training_rule_sets_params_check check (jsonb_typeof(params) = 'object'),
  constraint training_rule_sets_approved_check check ((status = 'approved') = (approved_at is not null) or status = 'retired')
);

-- Every call to an AI provider, with WHICH categories of data were sent (never the data itself). Cost/volume control + audit.
create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  purpose text not null,
  provider text not null,
  model text,
  status text not null,
  input_tokens integer,
  output_tokens integer,
  data_categories text[] not null,
  error text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint ai_calls_status_check check (status in ('ok', 'error', 'blocked')),
  constraint ai_calls_tokens_check check ((input_tokens is null or input_tokens >= 0) and (output_tokens is null or output_tokens >= 0)),
  constraint ai_calls_categories_check check (cardinality(data_categories) >= 1)
);

-- AI analysis of a meal photo. The model output is stored as received (`result`), flagged with its confidence, and stays
-- an ESTIMATE until the user reviews/corrects it (status -> reviewed).
create table public.meal_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meal_id uuid not null,
  status text not null default 'pending',
  provider text,
  model text,
  confidence text,
  result jsonb,
  error text,
  ai_call_id uuid,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (id, user_id),
  foreign key (meal_id, user_id) references public.meals (id, user_id) on delete cascade,
  foreign key (ai_call_id, user_id) references public.ai_calls (id, user_id) on delete set null (ai_call_id),
  constraint meal_analyses_status_check check (status in ('pending', 'succeeded', 'failed', 'reviewed')),
  constraint meal_analyses_confidence_check check (confidence is null or confidence in ('low', 'medium', 'high')),
  constraint meal_analyses_result_check check (result is null or jsonb_typeof(result) = 'object'),
  constraint meal_analyses_reviewed_check check ((status = 'reviewed') = (reviewed_at is not null))
);

create index availability_windows_user_idx on public.availability_windows (user_id, weekday);
create index ai_calls_user_time_idx on public.ai_calls (user_id, created_at desc);
create index meal_analyses_meal_idx on public.meal_analyses (meal_id);

alter table public.availability_windows enable row level security;
alter table public.training_rule_sets enable row level security;
alter table public.ai_calls enable row level security;
alter table public.meal_analyses enable row level security;
revoke all on public.availability_windows, public.training_rule_sets, public.ai_calls, public.meal_analyses from anon, authenticated;

grant select, insert, update, delete on public.availability_windows, public.meal_analyses to authenticated;
grant select, insert on public.training_rule_sets, public.ai_calls to authenticated;
grant update (status, approved_at, notes) on public.training_rule_sets to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['availability_windows', 'meal_analyses'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
  foreach t in array array['training_rule_sets', 'ai_calls'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
  end loop;
end
$$;
create policy training_rule_sets_update_own on public.training_rule_sets for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Current plan: the sessions of the LATEST version of every ACTIVE plan (security_invoker: the caller's RLS applies).
create view public.v_current_planned_workouts with (security_invoker = true) as
select w.id, w.user_id, p.id as plan_id, v.version as plan_version, w.session_id, w.modality, w.objective, w.starts_at,
       w.duration_minutes, w.intensity, w.targets, w.instructions, w.status
  from public.planned_workouts w
  join public.training_plan_versions v on v.id = w.plan_version_id and v.user_id = w.user_id
  join public.training_plans p on p.id = v.plan_id and p.user_id = v.user_id and p.status = 'active'
 where v.version = (select max(v2.version) from public.training_plan_versions v2 where v2.plan_id = v.plan_id);

-- THE shared layer: one row per local day with training load, sleep, recovery signals and intake side by side.
-- Rules: a day appears only if SOME record exists for it; every measure is NULL when unknown (never 0); *_known counts say how
-- much of the day's data is real; the timezone used is flagged when the profile has none (UTC is then ASSUMED, not known).
create view public.v_daily_context with (security_invoker = true) as
with tz as (
  select u.user_id, coalesce(p.timezone, 'UTC') as zone, (p.timezone is null) as timezone_assumed
    from (select user_id from public.daily_checkins union select user_id from public.sleep_observations
          union select user_id from public.completed_workouts union select user_id from public.meals
          union select user_id from public.physiological_observations) u
    left join public.profiles p on p.user_id = u.user_id
),
days as (
  select user_id, checkin_date as day from public.daily_checkins
  union select user_id, night_date from public.sleep_observations
  union select c.user_id, (c.started_at at time zone t.zone)::date from public.completed_workouts c join tz t on t.user_id = c.user_id
  union select m.user_id, (m.eaten_at at time zone t.zone)::date from public.meals m join tz t on t.user_id = m.user_id
  union select o.user_id, (o.observed_at at time zone t.zone)::date from public.physiological_observations o join tz t on t.user_id = o.user_id
)
select d.user_id, d.day, t.timezone_assumed,
       ck.sleep_quality_score, ck.fatigue_score, ck.energy_score, ck.mood_score, ck.recovery_score, ck.quality as checkin_quality,
       sl.duration_minutes as sleep_minutes, sl.source as sleep_source,
       rhr.value as resting_heart_rate, hrv.value as hrv, hrv.method as hrv_method,
       wk.workout_count, wk.workout_minutes, wk.workouts_without_duration,
       ml.meals_logged, ml.meals_with_estimate, ml.energy_kcal_estimated,
       (ml.meals_logged is not null) as intake_recorded
  from days d
  join tz t on t.user_id = d.user_id
  left join public.daily_checkins ck on ck.user_id = d.user_id and ck.checkin_date = d.day
  left join lateral (
    select s.duration_minutes, s.source from public.sleep_observations s
     where s.user_id = d.user_id and s.night_date = d.day and s.duration_minutes is not null
     order by case s.source when 'external_connector' then 0 when 'file_import' then 1 else 2 end, s.received_at desc limit 1
  ) sl on true
  left join lateral (
    select o.value from public.physiological_observations o
     where o.user_id = d.user_id and o.metric = 'resting_heart_rate' and o.availability = 'available'
       and (o.observed_at at time zone t.zone)::date = d.day
     order by case o.source when 'external_connector' then 0 when 'file_import' then 1 else 2 end, o.observed_at desc limit 1
  ) rhr on true
  left join lateral (
    select o.value, o.method from public.physiological_observations o
     where o.user_id = d.user_id and o.metric = 'heart_rate_variability' and o.availability = 'available'
       and (o.observed_at at time zone t.zone)::date = d.day
     order by case o.source when 'external_connector' then 0 when 'file_import' then 1 else 2 end, o.observed_at desc limit 1
  ) hrv on true
  left join lateral (
    select count(*)::int as workout_count, sum(c.duration_minutes)::int as workout_minutes,
           count(*) filter (where c.duration_minutes is null)::int as workouts_without_duration
      from public.completed_workouts c
     where c.user_id = d.user_id and (c.started_at at time zone t.zone)::date = d.day
  ) wk on wk.workout_count > 0
  left join lateral (
    select count(*)::int as meals_logged,
           count(*) filter (where exists (select 1 from public.nutrition_estimates e where e.meal_id = m.id and e.user_id = m.user_id and e.meal_item_id is null))::int as meals_with_estimate,
           sum((select sum(e.energy_kcal) from public.nutrition_estimates e where e.meal_id = m.id and e.user_id = m.user_id and e.meal_item_id is null))::numeric as energy_kcal_estimated
      from public.meals m
     where m.user_id = d.user_id and (m.eaten_at at time zone t.zone)::date = d.day
  ) ml on ml.meals_logged > 0;

revoke all on public.v_current_planned_workouts, public.v_daily_context from anon, authenticated;
grant select on public.v_current_planned_workouts, public.v_daily_context to authenticated;
