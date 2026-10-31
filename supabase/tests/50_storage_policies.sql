-- Meal photos: private bucket, owner-only objects under "<user id>/...".
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  b uuid := tests.new_user('b@example.invalid');
  n integer; pub boolean;
begin
  select public into pub from storage.buckets where id = 'meal-photos';
  perform tests.assert(pub is false, 'meal-photos bucket must exist and be PRIVATE');

  perform tests.as_user(a);
  insert into storage.objects (bucket_id, name) values ('meal-photos', a::text || '/lunch.jpg');
  perform tests.throws(format('insert into storage.objects (bucket_id, name) values (''meal-photos'', %L)', b::text || '/steal.jpg'), '42501', 'upload into another user''s folder');
  perform tests.throws('insert into storage.objects (bucket_id, name) values (''meal-photos'', ''loose.jpg'')', '42501', 'upload outside a user folder');
  perform tests.reset();

  perform tests.as_user(b);
  select count(*) into n from storage.objects where bucket_id = 'meal-photos';
  perform tests.assert(n = 0, 'B lists A''s photos');
  delete from storage.objects where bucket_id = 'meal-photos';
  get diagnostics n = row_count;
  perform tests.assert(n = 0, 'B deleted A''s photos');
  perform tests.reset();

  perform tests.as_anon();
  select count(*) into n from storage.objects where bucket_id = 'meal-photos';
  perform tests.assert(n = 0, 'anon lists photos');
  perform tests.throws('insert into storage.objects (bucket_id, name) values (''meal-photos'', ''x/y.jpg'')', '42501', 'anon upload');
  perform tests.reset();
end
$$;
rollback;
