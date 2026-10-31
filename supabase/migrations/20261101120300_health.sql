-- Migration 4/6: daily check-ins, sleep and physiological observations.
-- Every health record carries: source, event time, received_at, row quality and (optionally) the import that produced it.
--   * absence of a record  = there is NO row for that day/metric (never a row full of zeros)
--   * partial record       = some columns NULL (quality 'partial')
--   * real zero            = the column holds 0 (e.g. duration_minutes = 0 is allowed for sleep; NULL means unknown)
-- Self-report scores use a 1..5 integer scale: PROPOSAL P-29, pending approval (docs/DECISIONS.md). No clinical interpretation.

create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Local calendar date of the check-in, decided by the app from the user's timezone.
  checkin_date date not null,
  sleep_quality_score smallint,
  fatigue_score smallint,
  energy_score smallint,
  mood_score smallint,
  recovery_score smallint,
  notes text,
  source text not null default 'manual',
  recorded_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  -- Derived, never typed: 'complete' only when all five scores were given.
  quality text generated always as (
    case when sleep_quality_score is not null and fatigue_score is not null and energy_score is not null
              and mood_score is not null and recovery_score is not null
         then 'complete' else 'partial' end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, checkin_date),
  constraint daily_checkins_source_check check (source in ('manual', 'file_import', 'external_connector')),
  constraint daily_checkins_scores_check check (
    (sleep_quality_score is null or sleep_quality_score between 1 and 5) and
    (fatigue_score is null or fatigue_score between 1 and 5) and
    (energy_score is null or energy_score between 1 and 5) and
    (mood_score is null or mood_score between 1 and 5) and
    (recovery_score is null or recovery_score between 1 and 5)
  ),
  -- A check-in with nothing answered would be indistinguishable from "no check-in": not a valid row.
  constraint daily_checkins_not_empty_check check (
    sleep_quality_score is not null or fatigue_score is not null or energy_score is not null
    or mood_score is not null or recovery_score is not null or (notes is not null and length(btrim(notes)) > 0)
  )
);

create table public.sleep_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Local date of the night (the date the sleep period ended), decided by the app.
  night_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer,
  subjective_quality smallint,
  -- Source-specific stage breakdown, stored as received. Definitions differ across sources: not comparable by default.
  stages jsonb,
  source text not null default 'manual',
  external_id text,
  import_id uuid,
  recorded_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  quality text not null default 'complete',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, source, night_date),
  foreign key (import_id, user_id) references public.data_import_provenance (id, user_id) on delete set null (import_id),
  constraint sleep_observations_source_check check (source in ('manual', 'file_import', 'external_connector')),
  constraint sleep_observations_quality_check check (quality in ('complete', 'partial', 'conflicting')),
  constraint sleep_observations_duration_check check (duration_minutes is null or duration_minutes >= 0),
  constraint sleep_observations_period_check check (ended_at is null or started_at is null or ended_at > started_at),
  constraint sleep_observations_subjective_check check (subjective_quality is null or subjective_quality between 1 and 5),
  constraint sleep_observations_stages_check check (stages is null or jsonb_typeof(stages) = 'object'),
  constraint sleep_observations_not_empty_check check (
    duration_minutes is not null or (started_at is not null and ended_at is not null) or subjective_quality is not null
  ),
  constraint sleep_observations_external_check check (source = 'manual' or external_id is not null)
);

create table public.physiological_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  metric text not null,
  observed_at timestamptz not null,
  -- 'not_measured' records that the source explicitly had no value (distinct from 0 and from "no row at all").
  availability text not null default 'available',
  value numeric,
  unit text,
  -- Measurement method/algorithm as named by the source (HRV definitions differ between vendors).
  method text,
  source text not null default 'manual',
  external_id text,
  import_id uuid,
  recorded_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  quality text not null default 'complete',
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, source, metric, observed_at),
  foreign key (import_id, user_id) references public.data_import_provenance (id, user_id) on delete set null (import_id),
  constraint physiological_observations_metric_check check (metric in ('resting_heart_rate', 'heart_rate_variability')),
  constraint physiological_observations_availability_check check (availability in ('available', 'not_measured')),
  constraint physiological_observations_value_check check (
    (availability = 'available' and value is not null and value >= 0 and unit is not null)
    or (availability = 'not_measured' and value is null and unit is null)
  ),
  constraint physiological_observations_source_check check (source in ('manual', 'file_import', 'external_connector')),
  constraint physiological_observations_quality_check check (quality in ('complete', 'partial', 'conflicting')),
  constraint physiological_observations_external_check check (source = 'manual' or external_id is not null)
);

create trigger daily_checkins_set_updated_at before update on public.daily_checkins for each row execute function public.set_updated_at();
create trigger sleep_observations_set_updated_at before update on public.sleep_observations for each row execute function public.set_updated_at();

create index daily_checkins_user_date_idx on public.daily_checkins (user_id, checkin_date desc);
create index sleep_observations_user_night_idx on public.sleep_observations (user_id, night_date desc);
create index physiological_observations_user_metric_idx on public.physiological_observations (user_id, metric, observed_at desc);

alter table public.daily_checkins enable row level security;
alter table public.sleep_observations enable row level security;
alter table public.physiological_observations enable row level security;
revoke all on public.daily_checkins, public.sleep_observations, public.physiological_observations from anon, authenticated;
grant select, insert, update, delete on public.daily_checkins, public.sleep_observations, public.physiological_observations to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['daily_checkins', 'sleep_observations', 'physiological_observations'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end
$$;
