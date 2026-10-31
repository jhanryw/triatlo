-- Triatlo Inteligente — migration 1/6: helpers.
-- Conventions for every personal table in this project:
--   * user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users ON DELETE CASCADE
--   * UNIQUE (id, user_id) on parents + composite FKs (child_id, user_id): a row can never point at another user's row
--   * RLS enabled, privileges for anon/authenticated revoked then granted explicitly, one policy per operation
--   * absence of a record = no row; partial record = NULL columns (+ quality 'partial'); zero = a real 0 value
-- Supabase grants ALL on new public tables to anon/authenticated by default: every migration revokes it explicitly.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

comment on function public.set_updated_at() is 'BEFORE UPDATE trigger: keeps updated_at current.';
