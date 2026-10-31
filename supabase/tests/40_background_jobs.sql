-- Queue semantics for the worker: idempotent enqueue, exclusive claims, lease expiry, retries, dead letters, supersession.
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  j1 uuid; j2 uuid; dup uuid; n integer; st text; ok boolean; r record;
begin
  -- end users cannot touch the queue at all
  perform tests.as_user(a);
  perform tests.throws('select * from public.background_jobs', '42501', 'user reads queue');
  perform tests.throws(format('select public.enqueue_background_job(''adapt.daily'', %L, now(), ''k0'')', a), '42501', 'user enqueues a job');
  perform tests.reset();

  perform tests.as_service();
  select public.enqueue_background_job('adapt.daily', a, now() - interval '1 minute', 'adapt.daily:a:2026-11-02', 'plan:1@v1', '{}'::jsonb, 3) into j1;
  perform tests.assert(j1 is not null, 'enqueue returned no id');
  select public.enqueue_background_job('adapt.daily', a, now(), 'adapt.daily:a:2026-11-02') into dup;
  perform tests.assert(dup is null, 'duplicate idempotency key must be a no-op');
  perform tests.throws('select public.enqueue_background_job(''do.anything'', null, now(), ''k1'')', '23514', 'unknown job type');

  -- a future job is not claimed
  select public.enqueue_background_job('adapt.evaluate', a, now() + interval '1 hour', 'future') into j2;
  select count(*) into n from public.claim_background_jobs('w1', 10, 60);
  perform tests.assert(n = 1, 'claim must return only the due job, got ' || n);

  -- claimed job is exclusive while the lease is valid
  select count(*) into n from public.claim_background_jobs('w2', 10, 60);
  perform tests.assert(n = 0, 'a leased job was claimed twice');
  select status, attempts into r from public.background_jobs where id = j1;
  perform tests.assert(r.status = 'claimed' and r.attempts = 1, 'job not marked claimed with attempts=1');

  -- wrong worker cannot complete; right worker can
  select public.complete_background_job(j1, 'w2') into ok;
  perform tests.assert(ok is false, 'another worker completed the job');
  select public.complete_background_job(j1, 'w1') into ok;
  perform tests.assert(ok is true, 'owner could not complete the job');
  select status into st from public.background_jobs where id = j1;
  perform tests.assert(st = 'succeeded', 'completed job must be succeeded');
  perform tests.reset();

  -- lease expiry makes the job claimable again (worker crash / restart)
  perform tests.as_service();
  select public.enqueue_background_job('notification.dispatch', a, now(), 'crash-test', null, '{}'::jsonb, 2) into j2;
  perform public.claim_background_jobs('w1', 10, 60);
  update public.background_jobs set locked_until = now() - interval '1 second' where id = j2;
  select count(*) into n from public.claim_background_jobs('w2', 10, 60);
  perform tests.assert(n = 1, 'expired lease was not reclaimed');
  select attempts into n from public.background_jobs where id = j2;
  perform tests.assert(n = 2, 'attempts must count the reclaim');

  -- with no attempts left an expired job becomes dead, never retried silently
  update public.background_jobs set locked_until = now() - interval '1 second' where id = j2;
  select count(*) into n from public.claim_background_jobs('w3', 10, 60);
  perform tests.assert(n = 0, 'job beyond max_attempts was claimed');
  select status into st from public.background_jobs where id = j2;
  perform tests.assert(st = 'dead', 'job beyond max_attempts must be dead, was ' || st);

  -- failures: retry while attempts remain, dead afterwards
  select public.enqueue_background_job('adapt.evaluate', a, now(), 'retry-test', null, '{}'::jsonb, 2) into j1;
  perform public.claim_background_jobs('w1', 10, 60);
  select public.fail_background_job(j1, 'w1', 'boom', 0) into st;
  perform tests.assert(st = 'pending', 'first failure must retry, got ' || coalesce(st, 'null'));
  perform public.claim_background_jobs('w1', 10, 60);
  select public.fail_background_job(j1, 'w1', 'boom again', 0) into st;
  perform tests.assert(st = 'dead', 'last failure must be dead, got ' || coalesce(st, 'null'));

  -- supersession: rescheduling cancels older pending jobs of the same source
  select public.enqueue_background_job('notification.dispatch', a, now() + interval '1 day', 'sup-1', 'session:7@v1') into j1;
  select public.enqueue_background_job('notification.dispatch', a, now() + interval '1 day', 'sup-2', 'session:8@v1') into j2;
  select public.supersede_background_jobs(a, 'session:7@v1') into n;
  perform tests.assert(n = 1, 'supersede must affect exactly one job');
  select status into st from public.background_jobs where id = j1;
  perform tests.assert(st = 'superseded', 'old job not superseded');
  select status into st from public.background_jobs where id = j2;
  perform tests.assert(st = 'pending', 'unrelated job was touched');
  perform tests.reset();
end
$$;
rollback;
