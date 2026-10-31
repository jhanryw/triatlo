-- Push subscriptions belong to the authenticated user, their keys are unreadable to clients, and only the worker can send.
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  b uuid := tests.new_user('b@example.invalid');
  sub uuid; n integer; k text;
begin
  perform tests.as_user(a);
  perform tests.throws(format('insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, consent_text_version) values (%L, ''https://push.example/a'', ''k'', ''s'', ''v1'')', b), '42501', 'subscription registered for another user');
  perform tests.throws('insert into public.push_subscriptions (endpoint, p256dh, auth, consent_text_version) values (''http://insecure.example/a'', ''k'', ''s'', ''v1'')', '23514', 'non-https endpoint');
  insert into public.push_subscriptions (endpoint, p256dh, auth, user_agent, display_mode, consent_text_version)
    values ('https://push.example/a', 'p256dh-secret', 'auth-secret', 'test', 'standalone', 'v1') returning id into sub;
  perform tests.throws('select p256dh from public.push_subscriptions', '42501', 'client reads subscription keys');
  perform tests.throws('select auth from public.push_subscriptions', '42501', 'client reads subscription auth secret');
  perform tests.throws('select * from public.push_subscriptions', '42501', 'select * would include the keys');
  select count(*) into n from (select id, endpoint, active from public.push_subscriptions) s;
  perform tests.assert(n = 1, 'owner cannot list own devices');
  perform tests.throws('update public.push_subscriptions set endpoint = ''https://elsewhere.example''', '42501', 'edit endpoint');
  update public.push_subscriptions set active = false;
  perform tests.throws(format('insert into public.push_subscriptions (endpoint, p256dh, auth, consent_text_version) values (''https://push.example/a'', ''x'', ''y'', ''v1'')'), '23505', 'duplicate endpoint');

  -- notifications: a user can schedule for themselves (pending) and cancel; cannot mark sent or edit content
  insert into public.scheduled_notifications (kind, run_at, payload, idempotency_key) values ('workout_reminder', now(), '{"title":"t"}', 'n-1');
  perform tests.throws('insert into public.scheduled_notifications (kind, run_at, payload, idempotency_key, status) values (''workout_reminder'', now(), ''{}'', ''n-2'', ''sent'')', '42501', 'insert as already sent');
  perform tests.throws('insert into public.scheduled_notifications (kind, run_at, payload, idempotency_key) values (''free_text'', now(), ''{}'', ''n-3'')', '23514', 'unknown notification kind');
  perform tests.throws('update public.scheduled_notifications set status = ''sent''', '42501', 'user marks notification as sent');
  perform tests.throws('update public.scheduled_notifications set payload = ''{"title":"phish"}''', '42501', 'user edits queued payload');
  update public.scheduled_notifications set status = 'cancelled';

  -- B sees none of it and cannot cancel A's pending notifications
  perform tests.reset();
  perform tests.as_user(b);
  select count(*) into n from public.scheduled_notifications;
  perform tests.assert(n = 0, 'B sees A''s notifications');
  select count(*) into n from (select id from public.push_subscriptions) s;
  perform tests.assert(n = 0, 'B sees A''s devices');
  perform tests.reset();

  -- the worker (service_role) can read the keys it needs to send
  perform tests.as_service();
  select p256dh into k from public.push_subscriptions where id = sub;
  perform tests.assert(k = 'p256dh-secret', 'worker cannot read subscription keys');
  perform tests.reset();
end
$$;
rollback;
