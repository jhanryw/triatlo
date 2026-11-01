-- Stand-ins for a BARE PostgreSQL (CI/local only). On a real Supabase database almost nothing here is created.
-- NEVER run against production: tests/run.sh --production does not execute this file.
-- Test prelude. Idempotent. On the real Supabase Postgres image almost everything below already exists and is left alone;
-- on a bare PostgreSQL it creates minimal stand-ins so the same migrations and tests run (never used in production).
do $$
declare
  r text;
  bare boolean := to_regclass('auth.users') is null;   -- bare PostgreSQL (no Supabase): everything below is a stand-in
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin %s', r, case when r = 'service_role' then 'bypassrls' else '' end);
    end if;
    if bare then
      -- Supabase grants ALL on new public tables/functions to these roles by default (per database); reproduce it so
      -- the revokes in the migrations are really exercised.
      execute format('alter default privileges in schema public grant all on tables to %I', r);
      execute format('alter default privileges in schema public grant all on functions to %I', r);
    end if;
  end loop;

  if to_regclass('auth.users') is null then
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
  end if;
  -- GoTrue's own migrations define auth.uid() to read the JWT claims that PostgREST (>= 10) sets in `request.jwt.claims`.
  -- The bare image (no GoTrue run) ships a legacy version that reads only `request.jwt.claim.sub`, which PostgREST no
  -- longer sets, so every RLS check would see NULL. Mirror the migrated definition here; production mode never touches it
  -- and instead PROVES the real function (36_auth_uid_contract.sql).
  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;

  if to_regclass('storage.objects') is null then
    create schema if not exists storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false,
                                  file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
                                  name text, owner uuid default auth.uid());
    alter table storage.objects enable row level security;
    grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
  end if;
end
$$;

grant usage on schema auth, public, storage to anon, authenticated, service_role;

