-- Migration 2/6: personal profile and preferences.

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text,
  -- IANA zone chosen by the user (e.g. America/Sao_Paulo). NULL until set: nothing assumes a zone (pending Q-07).
  timezone text,
  locale text not null default 'pt-BR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_check check (display_name is null or length(btrim(display_name)) between 1 and 80),
  constraint profiles_timezone_check check (timezone is null or length(timezone) between 3 and 64)
);

create table public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  week_starts_on smallint not null default 1,
  -- Quiet hours (local wall-clock). Both NULL = not configured. Notification limits stay pending (Q-11).
  quiet_hours_start time,
  quiet_hours_end time,
  notifications_enabled boolean not null default false,
  -- Consent to send data to an AI provider. NULL = no consent: nothing is sent.
  ai_processing_consent_at timestamptz,
  -- Autonomy (mirrors packages/domain AutonomyConfig). Safe defaults: nothing is applied automatically.
  auto_apply_enabled boolean not null default false,
  approved_limits_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_week_starts_on_check check (week_starts_on between 0 and 6),
  constraint user_preferences_quiet_hours_check check ((quiet_hours_start is null) = (quiet_hours_end is null)),
  -- Automatic application requires an approved set of limits (docs/DECISIONS.md Q-06). No numbers live here.
  constraint user_preferences_autonomy_check check (not auto_apply_enabled or approved_limits_version is not null)
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- Access control
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
revoke all on public.profiles, public.user_preferences from anon, authenticated;
grant select, insert, update, delete on public.profiles, public.user_preferences to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy profiles_delete_own on public.profiles for delete to authenticated using (user_id = (select auth.uid()));

create policy user_preferences_select_own on public.user_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy user_preferences_insert_own on public.user_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_preferences_update_own on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy user_preferences_delete_own on public.user_preferences for delete to authenticated using (user_id = (select auth.uid()));
