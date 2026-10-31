-- Migration 7: private Storage bucket for meal photos + owner-only object policies.
-- Applies only once Storage's own tables exist (the storage-api service creates them at its first start); on a database
-- without Storage (e.g. a bare Postgres in CI) it does nothing. Re-running is safe.

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present: skipping meal-photos bucket (apply again after the Storage service has started)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('meal-photos', 'meal-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do update
    set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists meal_photos_select_own on storage.objects;
  drop policy if exists meal_photos_insert_own on storage.objects;
  drop policy if exists meal_photos_update_own on storage.objects;
  drop policy if exists meal_photos_delete_own on storage.objects;

  -- Objects live under "<user id>/...". No listing or reading of anyone else's folder; anon has no policy at all.
  create policy meal_photos_select_own on storage.objects for select to authenticated
    using (bucket_id = 'meal-photos' and split_part(name, '/', 1) = (select auth.uid())::text);
  create policy meal_photos_insert_own on storage.objects for insert to authenticated
    with check (bucket_id = 'meal-photos' and split_part(name, '/', 1) = (select auth.uid())::text);
  create policy meal_photos_update_own on storage.objects for update to authenticated
    using (bucket_id = 'meal-photos' and split_part(name, '/', 1) = (select auth.uid())::text)
    with check (bucket_id = 'meal-photos' and split_part(name, '/', 1) = (select auth.uid())::text);
  create policy meal_photos_delete_own on storage.objects for delete to authenticated
    using (bucket_id = 'meal-photos' and split_part(name, '/', 1) = (select auth.uid())::text);
end
$$;
