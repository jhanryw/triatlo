-- Test helpers (schema `tests`). Safe to run anywhere: it creates only the `tests` schema, which run.sh drops in --production mode.
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

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
  execute 'set local role authenticated';
end $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create or replace function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;

create or replace function tests.reset() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
