-- auth.uid() must resolve from `request.jwt.claims` ALONE: that is the only claim setting PostgREST (>= 10, we run 14.8) provides.
-- A legacy auth.uid() that reads only `request.jwt.claim.sub` would return NULL for every request and silently break every
-- RLS policy (reads return nothing, writes are refused). In --production this checks the REAL function in the real database.
begin;
do $$
declare
  a uuid := tests.new_user('uid-a@example.invalid');
  got uuid;
begin
  perform tests.as_user(a);
  select auth.uid() into got;
  perform tests.assert(got = a, 'auth.uid() must return the JWT sub from request.jwt.claims alone (PostgREST behaviour)');
  perform tests.assert(coalesce(current_setting('request.jwt.claim.sub', true), '') = '', 'this test must not set the legacy request.jwt.claim.sub');

  perform tests.as_anon();
  select auth.uid() into got;
  perform tests.assert(got is null, 'auth.uid() is NULL without a user token');

  perform tests.as_service();
  select auth.uid() into got;
  perform tests.assert(got is null, 'service role carries no user id');
  perform tests.reset();
end $$;
rollback;
