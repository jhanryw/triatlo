-- Check-ins, sleep, physiological observations: absence vs partial vs zero, availability, provenance and idempotent imports.
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  q text; n integer; imp uuid;
begin
  perform tests.as_user(a);

  ---------------------------------------------------------------- daily check-ins
  perform tests.throws('insert into public.daily_checkins (checkin_date) values (date ''2026-11-01'')', '23514', 'empty check-in');
  perform tests.throws('insert into public.daily_checkins (checkin_date, mood_score) values (date ''2026-11-01'', 6)', '23514', 'score above scale');
  perform tests.throws('insert into public.daily_checkins (checkin_date, mood_score) values (date ''2026-11-01'', 0)', '23514', 'score below scale');
  insert into public.daily_checkins (checkin_date, fatigue_score) values (date '2026-11-01', 4);
  insert into public.daily_checkins (checkin_date, sleep_quality_score, fatigue_score, energy_score, mood_score, recovery_score)
    values (date '2026-11-02', 3, 3, 3, 3, 3);
  perform tests.throws('insert into public.daily_checkins (checkin_date, mood_score) values (date ''2026-11-02'', 2)', '23505', 'two check-ins for one day');
  select quality into q from public.daily_checkins where checkin_date = date '2026-11-01';
  perform tests.assert(q = 'partial', 'single-score check-in must be partial, was ' || coalesce(q, 'null'));
  select quality into q from public.daily_checkins where checkin_date = date '2026-11-02';
  perform tests.assert(q = 'complete', 'full check-in must be complete');
  select count(*) into n from public.daily_checkins where checkin_date = date '2026-11-03';
  perform tests.assert(n = 0, 'a day without a check-in must have NO row (absence is not zero)');
  perform tests.throws('update public.daily_checkins set quality = ''complete''', '428C9', 'quality is generated and cannot be written');

  ---------------------------------------------------------------- sleep: unknown (NULL) vs zero vs no row
  perform tests.throws('insert into public.sleep_observations (night_date) values (date ''2026-11-01'')', '23514', 'sleep row with no information');
  perform tests.throws('insert into public.sleep_observations (night_date, duration_minutes) values (date ''2026-11-01'', -1)', '23514', 'negative sleep');
  perform tests.throws('insert into public.sleep_observations (night_date, started_at, ended_at) values (date ''2026-11-01'', now(), now() - interval ''1 hour'')', '23514', 'sleep ends before it starts');
  insert into public.sleep_observations (night_date, duration_minutes) values (date '2026-11-01', 0);             -- a real zero
  insert into public.sleep_observations (night_date, subjective_quality) values (date '2026-11-02', 2);          -- duration unknown
  select count(*) into n from public.sleep_observations where duration_minutes = 0;
  perform tests.assert(n = 1, 'a recorded zero must be stored as 0');
  select count(*) into n from public.sleep_observations where duration_minutes is null;
  perform tests.assert(n = 1, 'unknown duration must be NULL, not 0');
  select count(*) into n from public.sleep_observations where night_date = date '2026-11-03';
  perform tests.assert(n = 0, 'a night without data must have NO row');
  perform tests.throws('insert into public.sleep_observations (night_date, duration_minutes, source) values (date ''2026-11-04'', 400, ''file_import'')', '23514', 'imported record without external_id');
  perform tests.throws('insert into public.sleep_observations (night_date, duration_minutes, quality) values (date ''2026-11-04'', 400, ''missing'')', '23514', 'row quality "missing" is not a row state');

  ---------------------------------------------------------------- physiological observations: available vs not measured vs zero
  insert into public.physiological_observations (metric, observed_at, value, unit) values ('resting_heart_rate', '2026-11-02T07:00:00Z', 0, 'bpm');
  insert into public.physiological_observations (metric, observed_at, availability) values ('heart_rate_variability', '2026-11-02T07:00:00Z', 'not_measured');
  perform tests.throws('insert into public.physiological_observations (metric, observed_at, availability, value, unit) values (''heart_rate_variability'', ''2026-11-03T07:00:00Z'', ''not_measured'', 40, ''ms'')', '23514', 'not_measured must not carry a value');
  perform tests.throws('insert into public.physiological_observations (metric, observed_at, availability) values (''resting_heart_rate'', ''2026-11-03T07:00:00Z'', ''available'')', '23514', 'available needs value and unit');
  perform tests.throws('insert into public.physiological_observations (metric, observed_at, value, unit) values (''blood_glucose'', ''2026-11-03T07:00:00Z'', 90, ''x'')', '23514', 'unknown metric');
  select count(*) into n from public.physiological_observations where availability = 'available' and value = 0;
  perform tests.assert(n = 1, 'zero must be storable as a real value');
  select count(*) into n from public.physiological_observations where availability = 'not_measured' and value is null;
  perform tests.assert(n = 1, 'not measured must be represented explicitly');

  ---------------------------------------------------------------- completed workouts and idempotent imports
  perform tests.throws('insert into public.completed_workouts (modality, started_at, duration_minutes) values (''run'', now(), 0)', '23514', 'zero-duration workout (use NULL when unknown)');
  perform tests.throws('insert into public.completed_workouts (modality, started_at, perceived_exertion_scale) values (''run'', now(), ''rpe'')', '23514', 'exertion scale without value');
  perform tests.throws('insert into public.completed_workouts (modality, started_at, source) values (''run'', now(), ''external_connector'')', '23514', 'external record without external_id');
  insert into public.data_import_provenance (source_kind, source_id, file_name, records_received) values ('file_import', 'csv-v1', 'week.csv', 1) returning id into imp;
  insert into public.completed_workouts (modality, started_at, source, external_id, import_id, quality) values ('swim', now(), 'file_import', 'ext-1', imp, 'partial');
  perform tests.throws(format('insert into public.completed_workouts (modality, started_at, source, external_id, import_id) values (''swim'', now(), ''file_import'', ''ext-1'', %L)', imp), '23505', 're-importing the same external record');
  insert into public.completed_workouts (modality, started_at) values ('run', now());                       -- manual, nothing else known
  select count(*) into n from public.completed_workouts where duration_minutes is null and distance_meters is null and avg_heart_rate_bpm is null;
  perform tests.assert(n = 2, 'unknown measures must stay NULL');
  perform tests.reset();
end
$$;
rollback;
