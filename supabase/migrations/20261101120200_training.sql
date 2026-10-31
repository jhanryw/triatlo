-- Migration 3/6: training plans (immutable versions), planned workouts, completed workouts, proposals, approvals, audit.
-- No physiological limit, formula or default intensity exists in this schema (docs/DECISIONS.md Q-06).

-- Where an import came from (also referenced by health observations below). Defined first because others point at it.
create table public.data_import_provenance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_kind text not null,
  source_id text not null,
  status text not null default 'started',
  file_name text,
  file_sha256 text,
  records_received integer not null default 0,
  records_inserted integer not null default 0,
  records_skipped integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, user_id),
  constraint data_import_provenance_source_kind_check check (source_kind in ('manual', 'file_import', 'external_connector')),
  constraint data_import_provenance_status_check check (status in ('started', 'succeeded', 'failed', 'partial')),
  constraint data_import_provenance_counts_check check (records_received >= 0 and records_inserted >= 0 and records_skipped >= 0)
);

create table public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint training_plans_name_check check (length(btrim(name)) between 1 and 120),
  constraint training_plans_status_check check (status in ('active', 'archived'))
);

-- Immutable snapshots: authenticated can INSERT and SELECT only. Applying a proposal or undoing creates a NEW version.
create table public.training_plan_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id uuid not null,
  version integer not null,
  parent_version integer,
  created_by_kind text not null,
  created_by_ref text,
  reason text not null,
  proposal_id uuid,
  revert_of integer,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (plan_id, version),
  foreign key (plan_id, user_id) references public.training_plans (id, user_id) on delete cascade,
  -- the parent version must exist in the same plan: the chain v1 <- v2 <- v3 cannot have holes
  foreign key (plan_id, parent_version) references public.training_plan_versions (plan_id, version),
  constraint training_plan_versions_version_check check (version >= 1),
  constraint training_plan_versions_parent_check check ((parent_version is null) = (version = 1) and (parent_version is null or parent_version = version - 1)),
  constraint training_plan_versions_revert_check check (revert_of is null or (revert_of >= 1 and revert_of < version)),
  constraint training_plan_versions_created_by_kind_check check (created_by_kind in ('user', 'system', 'engine')),
  constraint training_plan_versions_reason_check check (length(btrim(reason)) >= 1)
);

-- One row per session per version (snapshot). session_id is the stable identity used by PlannedSession.id.
create table public.planned_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_version_id uuid not null,
  session_id uuid not null,
  modality text not null,
  objective text,
  starts_at timestamptz not null,
  duration_minutes integer not null,
  -- {"scale": "...", "value": "..."|number}: opaque; the scale is defined in BUSINESS_RULES.md, never by this schema.
  intensity jsonb,
  targets jsonb not null default '[]'::jsonb,
  instructions text,
  status text not null default 'planned',
  unique (id, user_id),
  unique (plan_version_id, session_id),
  foreign key (plan_version_id, user_id) references public.training_plan_versions (id, user_id) on delete cascade,
  constraint planned_workouts_modality_check check (modality in ('swim', 'bike_indoor', 'run', 'strength', 'recovery', 'rest')),
  constraint planned_workouts_status_check check (status in ('planned', 'completed', 'partial', 'replaced', 'rescheduled', 'cancelled')),
  constraint planned_workouts_duration_check check (duration_minutes > 0),
  constraint planned_workouts_intensity_check check (intensity is null or (jsonb_typeof(intensity) = 'object' and intensity ? 'scale' and intensity ? 'value')),
  constraint planned_workouts_targets_check check (jsonb_typeof(targets) = 'array')
);

create table public.completed_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Stable session identity from the plan (no FK: sessions are snapshotted per version). NULL = unplanned workout.
  planned_session_id uuid,
  modality text not null,
  completion text not null default 'completed',
  started_at timestamptz not null,
  -- NULL = unknown. (A duration of 0 is rejected: use NULL when it was not recorded.)
  duration_minutes integer,
  distance_meters numeric,
  avg_heart_rate_bpm integer,
  max_heart_rate_bpm integer,
  perceived_exertion_scale text,
  perceived_exertion_value numeric,
  notes text,
  -- Provenance and availability
  source text not null default 'manual',
  external_id text,
  import_id uuid,
  received_at timestamptz not null default now(),
  quality text not null default 'complete',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (import_id, user_id) references public.data_import_provenance (id, user_id) on delete set null (import_id),
  constraint completed_workouts_modality_check check (modality in ('swim', 'bike_indoor', 'run', 'strength', 'recovery', 'rest')),
  constraint completed_workouts_completion_check check (completion in ('completed', 'partial')),
  constraint completed_workouts_source_check check (source in ('manual', 'file_import', 'external_connector')),
  -- Row-level quality. 'missing' is not a row state: absence of a record is the ABSENCE of a row.
  constraint completed_workouts_quality_check check (quality in ('complete', 'partial', 'conflicting')),
  constraint completed_workouts_duration_check check (duration_minutes is null or duration_minutes > 0),
  constraint completed_workouts_distance_check check (distance_meters is null or distance_meters >= 0),
  constraint completed_workouts_heart_rate_check check ((avg_heart_rate_bpm is null or avg_heart_rate_bpm > 0) and (max_heart_rate_bpm is null or max_heart_rate_bpm > 0)),
  constraint completed_workouts_exertion_check check ((perceived_exertion_scale is null) = (perceived_exertion_value is null)),
  constraint completed_workouts_external_check check (source = 'manual' or external_id is not null)
);
create unique index completed_workouts_import_idempotency on public.completed_workouts (user_id, source, external_id) where external_id is not null;

create table public.workout_change_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id uuid not null,
  base_version integer not null,
  change_class text not null,
  trigger_type text not null,
  trigger_ref text,
  changes jsonb not null,
  rationale jsonb not null,
  status text not null default 'proposed',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  decided_at timestamptz,
  applied_version integer,
  unique (id, user_id),
  foreign key (plan_id, user_id) references public.training_plans (id, user_id) on delete cascade,
  constraint workout_change_proposals_class_check check (change_class in ('auto_safe', 'needs_approval', 'structural')),
  constraint workout_change_proposals_trigger_check check (trigger_type in ('daily', 'event', 'manual')),
  constraint workout_change_proposals_status_check check (status in ('proposed', 'approved', 'rejected', 'applied', 'reverted', 'expired', 'superseded')),
  constraint workout_change_proposals_base_version_check check (base_version >= 1),
  constraint workout_change_proposals_changes_check check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) >= 1),
  constraint workout_change_proposals_rationale_check check (jsonb_typeof(rationale) = 'object' and rationale ? 'summary' and rationale ? 'dataQuality'),
  constraint workout_change_proposals_applied_check check ((applied_version is not null) = (status in ('applied', 'reverted')))
);

alter table public.training_plan_versions
  add foreign key (proposal_id, user_id) references public.workout_change_proposals (id, user_id) on delete set null (proposal_id);

-- One decision per proposal; immutable. The decision always comes from the user.
create table public.user_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  proposal_id uuid not null,
  decision text not null,
  note text,
  decided_at timestamptz not null default now(),
  unique (proposal_id),
  foreign key (proposal_id, user_id) references public.workout_change_proposals (id, user_id) on delete cascade,
  constraint user_approvals_decision_check check (decision in ('approved', 'rejected'))
);

-- Append-only audit of plan changes (automatic or not). authenticated: INSERT and SELECT only.
create table public.adaptation_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_kind text not null,
  actor_ref text,
  action text not null,
  plan_id uuid,
  proposal_id uuid,
  from_version integer,
  to_version integer,
  rule_ids text[] not null default '{}',
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  foreign key (plan_id, user_id) references public.training_plans (id, user_id) on delete set null (plan_id),
  foreign key (proposal_id, user_id) references public.workout_change_proposals (id, user_id) on delete set null (proposal_id),
  constraint adaptation_audit_actor_kind_check check (actor_kind in ('user', 'system', 'engine')),
  constraint adaptation_audit_action_check check (action in ('plan_created', 'proposal_created', 'proposal_approved', 'proposal_rejected', 'proposal_expired', 'proposal_superseded', 'plan_version_applied', 'plan_reverted')),
  constraint adaptation_audit_summary_check check (length(btrim(summary)) >= 1),
  constraint adaptation_audit_details_check check (jsonb_typeof(details) = 'object')
);

create trigger training_plans_set_updated_at before update on public.training_plans for each row execute function public.set_updated_at();
create trigger completed_workouts_set_updated_at before update on public.completed_workouts for each row execute function public.set_updated_at();

create index planned_workouts_user_starts_idx on public.planned_workouts (user_id, starts_at);
create index completed_workouts_user_started_idx on public.completed_workouts (user_id, started_at desc);
create index workout_change_proposals_user_status_idx on public.workout_change_proposals (user_id, status);
create index adaptation_audit_user_time_idx on public.adaptation_audit (user_id, occurred_at desc);

-- Access control ------------------------------------------------------------------------------------------------------
alter table public.data_import_provenance enable row level security;
alter table public.training_plans enable row level security;
alter table public.training_plan_versions enable row level security;
alter table public.planned_workouts enable row level security;
alter table public.completed_workouts enable row level security;
alter table public.workout_change_proposals enable row level security;
alter table public.user_approvals enable row level security;
alter table public.adaptation_audit enable row level security;

revoke all on public.data_import_provenance, public.training_plans, public.training_plan_versions, public.planned_workouts,
  public.completed_workouts, public.workout_change_proposals, public.user_approvals, public.adaptation_audit from anon, authenticated;

-- Mutable tables
grant select, insert, update, delete on public.data_import_provenance, public.training_plans, public.planned_workouts, public.completed_workouts to authenticated;
-- Immutable / append-only tables: no UPDATE, no DELETE for authenticated
grant select, insert on public.training_plan_versions, public.user_approvals, public.adaptation_audit to authenticated;
-- Proposals: the content is frozen after creation; only the lifecycle columns may change
grant select, insert, delete on public.workout_change_proposals to authenticated;
grant update (status, decided_at, applied_version) on public.workout_change_proposals to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['data_import_provenance', 'training_plans', 'planned_workouts', 'completed_workouts'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
  foreach t in array array['training_plan_versions', 'user_approvals', 'adaptation_audit'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
  end loop;
end
$$;

create policy workout_change_proposals_select_own on public.workout_change_proposals for select to authenticated using (user_id = (select auth.uid()));
create policy workout_change_proposals_insert_own on public.workout_change_proposals for insert to authenticated with check (user_id = (select auth.uid()));
create policy workout_change_proposals_update_own on public.workout_change_proposals for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy workout_change_proposals_delete_own on public.workout_change_proposals for delete to authenticated using (user_id = (select auth.uid()));
