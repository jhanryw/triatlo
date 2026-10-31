-- Migration 6/6: push subscriptions, scheduled notifications and background jobs.
-- Delivery is done ONLY by the worker (service_role). A browser/user session can never send a push to anyone.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  -- Encryption keys of the subscription. Writable by the owner, READABLE ONLY by the worker (column privileges below).
  p256dh text not null,
  auth text not null,
  user_agent text,
  display_mode text not null default 'browser',
  consent_text_version text not null,
  consent_at timestamptz not null default now(),
  active boolean not null default true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint push_subscriptions_display_mode_check check (display_mode in ('standalone', 'browser')),
  constraint push_subscriptions_endpoint_check check (endpoint like 'https://%')
);

create table public.scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  run_at timestamptz not null,
  status text not null default 'pending',
  -- {kind,title,body,url,tag}: validated by PushPayloadSchema before sending (no health data in payloads).
  payload jsonb not null,
  source_ref text,
  idempotency_key text not null unique,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint scheduled_notifications_kind_check check (kind in ('workout_reminder', 'meal_reminder', 'morning_checkin', 'post_workout_checkin', 'meal_prep', 'hydration_context', 'plan_change', 'approval_request', 'recovery_alert')),
  constraint scheduled_notifications_status_check check (status in ('pending', 'claimed', 'sent', 'failed', 'cancelled', 'superseded')),
  constraint scheduled_notifications_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint scheduled_notifications_attempts_check check (attempts >= 0)
);

-- Internal queue. No policy and no privilege for anon/authenticated: invisible and untouchable from any user session.
create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  type text not null,
  run_at timestamptz not null default now(),
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text not null unique,
  source_ref text,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  claimed_by text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint background_jobs_type_check check (type in ('notification.dispatch', 'adapt.daily', 'adapt.evaluate')),
  constraint background_jobs_status_check check (status in ('pending', 'claimed', 'succeeded', 'failed', 'dead', 'cancelled', 'superseded')),
  constraint background_jobs_attempts_check check (attempts >= 0 and max_attempts >= 1),
  constraint background_jobs_payload_check check (jsonb_typeof(payload) = 'object')
);

create trigger background_jobs_set_updated_at before update on public.background_jobs for each row execute function public.set_updated_at();
create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where active;
create index scheduled_notifications_due_idx on public.scheduled_notifications (run_at) where status = 'pending';
create index background_jobs_due_idx on public.background_jobs (run_at) where status in ('pending', 'claimed');

alter table public.push_subscriptions enable row level security;
alter table public.scheduled_notifications enable row level security;
alter table public.background_jobs enable row level security;
revoke all on public.push_subscriptions, public.scheduled_notifications, public.background_jobs from anon, authenticated;

-- push_subscriptions: the owner can register, list (WITHOUT the keys), deactivate and delete their devices.
grant select (id, user_id, endpoint, user_agent, display_mode, consent_text_version, consent_at, active, last_success_at, last_error_at, created_at)
  on public.push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth, user_agent, display_mode, consent_text_version, consent_at) on public.push_subscriptions to authenticated;
grant update (active) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()) and active);
create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- scheduled_notifications: the owner can schedule for themselves (pending only), read, and cancel. Sending is the worker's job.
grant select, insert on public.scheduled_notifications to authenticated;
grant update (status) on public.scheduled_notifications to authenticated;
create policy scheduled_notifications_select_own on public.scheduled_notifications for select to authenticated using (user_id = (select auth.uid()));
create policy scheduled_notifications_insert_own on public.scheduled_notifications for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and attempts = 0);
create policy scheduled_notifications_cancel_own on public.scheduled_notifications for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending') with check (user_id = (select auth.uid()) and status = 'cancelled');

-- Queue API for the worker (called through the Supabase API with the secret key, or directly with a database role).
create or replace function public.enqueue_background_job(
  p_type text, p_user_id uuid, p_run_at timestamptz, p_idempotency_key text,
  p_source_ref text default null, p_payload jsonb default '{}'::jsonb, p_max_attempts integer default 5
) returns uuid
language sql
set search_path = ''
as $$
  insert into public.background_jobs (type, user_id, run_at, idempotency_key, source_ref, payload, max_attempts)
  values (p_type, p_user_id, p_run_at, p_idempotency_key, p_source_ref, p_payload, p_max_attempts)
  on conflict (idempotency_key) do nothing
  returning id;
$$;

create or replace function public.claim_background_jobs(p_worker text, p_limit integer default 10, p_lease_seconds integer default 300)
returns setof public.background_jobs
language plpgsql
set search_path = ''
as $$
begin
  -- Jobs whose lease expired and that have no attempts left are dead, never silently retried.
  update public.background_jobs
     set status = 'dead', last_error = coalesce(last_error, 'lease expired after the last attempt'), locked_until = null
   where status = 'claimed' and locked_until < pg_catalog.now() and attempts >= max_attempts;

  return query
  with picked as (
    select j.id from public.background_jobs j
     where j.run_at <= pg_catalog.now()
       and j.attempts < j.max_attempts
       and (j.status = 'pending' or (j.status = 'claimed' and j.locked_until < pg_catalog.now()))
     order by j.run_at
     limit greatest(p_limit, 0)
     for update skip locked
  )
  update public.background_jobs b
     set status = 'claimed', claimed_by = p_worker, attempts = b.attempts + 1,
         locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from picked
   where b.id = picked.id
  returning b.*;
end;
$$;

create or replace function public.complete_background_job(p_id uuid, p_worker text)
returns boolean
language sql
set search_path = ''
as $$
  with done as (
    update public.background_jobs
       set status = 'succeeded', locked_until = null, last_error = null
     where id = p_id and status = 'claimed' and claimed_by = p_worker
    returning 1
  )
  select exists (select 1 from done);
$$;

create or replace function public.fail_background_job(p_id uuid, p_worker text, p_error text, p_retry_in_seconds integer default 60)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.background_jobs
     set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
         run_at = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(p_retry_in_seconds, 0)),
         last_error = pg_catalog.left(p_error, 500), locked_until = null, claimed_by = null
   where id = p_id and status = 'claimed' and claimed_by = p_worker
  returning status into v_status;
  return v_status;
end;
$$;

-- Rescheduling/changing an entity cancels its older pending jobs (the worker enqueues the new ones).
create or replace function public.supersede_background_jobs(p_user_id uuid, p_source_ref text)
returns integer
language sql
set search_path = ''
as $$
  with changed as (
    update public.background_jobs set status = 'superseded'
     where user_id = p_user_id and source_ref = p_source_ref and status = 'pending'
    returning 1
  )
  select count(*)::integer from changed;
$$;

revoke all on function public.enqueue_background_job(text, uuid, timestamptz, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.claim_background_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_background_job(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_background_job(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.supersede_background_jobs(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_background_job(text, uuid, timestamptz, text, text, jsonb, integer) to service_role;
grant execute on function public.claim_background_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_background_job(uuid, text) to service_role;
grant execute on function public.fail_background_job(uuid, text, text, integer) to service_role;
grant execute on function public.supersede_background_jobs(uuid, text) to service_role;
