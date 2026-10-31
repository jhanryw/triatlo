-- Test prelude. Idempotent. On the real Supabase Postgres image almost everything below already exists and is left alone;
-- on a bare PostgreSQL it creates minimal stand-ins so the same migrations and tests run (never used in production).
create schema if not exists tests;

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
  if to_regprocedure('auth.uid()') is null then
    create function auth.uid() returns uuid language sql stable as
      $f$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
  end if;

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

grant usage on schema auth, public, storage, tests to anon, authenticated, service_role;

create or replace function tests.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if;
end $$;

-- Runs a statement and requires it to fail with the given SQLSTATE (42501 = permission/RLS, 23514 = check, 23503 = FK, 23505 = unique).
create or replace function tests.throws(stmt text, expected text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'ASSERTION FAILED: % (expected SQLSTATE %, got %: %)', msg, expected, sqlstate, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % (statement did not fail)', msg;
end $$;

create or replace function tests.new_user(p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v, p_email);
  return v;
end $$;

create or replace function tests.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end $$;

create or replace function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
end $$;

create or replace function tests.reset() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
