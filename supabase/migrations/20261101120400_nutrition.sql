-- Migration 5/6: meals, meal items and nutrition estimates.
-- Intake is an UNCERTAIN estimate. A day without meals recorded means "not recorded", never "did not eat".
-- Nothing here encodes a calorie target, restriction or clinical rule.

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  eaten_at timestamptz not null,
  meal_type text not null,
  notes text,
  -- Path inside the private bucket 'meal-photos'; the first segment must be the owner's user id (see storage migration).
  photo_path text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint meals_meal_type_check check (meal_type in ('breakfast', 'lunch', 'snack', 'dinner', 'other')),
  constraint meals_source_check check (source in ('manual', 'file_import', 'external_connector')),
  constraint meals_photo_path_check check (photo_path is null or split_part(photo_path, '/', 1) = user_id::text)
);

create table public.meal_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meal_id uuid not null,
  name text not null,
  -- NULL = unknown quantity; 0 is a real, deliberate value.
  quantity numeric,
  unit text,
  quantity_origin text not null default 'user',
  user_corrected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (meal_id, user_id) references public.meals (id, user_id) on delete cascade,
  constraint meal_items_name_check check (length(btrim(name)) between 1 and 120),
  constraint meal_items_quantity_check check (quantity is null or quantity >= 0),
  constraint meal_items_unit_check check ((quantity is null) = (unit is null)),
  constraint meal_items_origin_check check (quantity_origin in ('user', 'estimated'))
);

create table public.nutrition_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meal_id uuid not null,
  meal_item_id uuid,
  -- NULL = not estimated; 0 = estimated as zero.
  energy_kcal numeric,
  protein_g numeric,
  carbohydrate_g numeric,
  fat_g numeric,
  method text not null,
  model text,
  confidence text,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (meal_id, user_id) references public.meals (id, user_id) on delete cascade,
  foreign key (meal_item_id, user_id) references public.meal_items (id, user_id) on delete cascade,
  constraint nutrition_estimates_values_check check (
    (energy_kcal is null or energy_kcal >= 0) and (protein_g is null or protein_g >= 0)
    and (carbohydrate_g is null or carbohydrate_g >= 0) and (fat_g is null or fat_g >= 0)
  ),
  constraint nutrition_estimates_not_empty_check check (
    energy_kcal is not null or protein_g is not null or carbohydrate_g is not null or fat_g is not null
  ),
  constraint nutrition_estimates_method_check check (method in ('manual', 'ai', 'reference_table')),
  constraint nutrition_estimates_confidence_check check (confidence is null or confidence in ('low', 'medium', 'high'))
);

create trigger meals_set_updated_at before update on public.meals for each row execute function public.set_updated_at();
create index meals_user_eaten_idx on public.meals (user_id, eaten_at desc);
create index meal_items_meal_idx on public.meal_items (meal_id);
create index nutrition_estimates_meal_idx on public.nutrition_estimates (meal_id);

alter table public.meals enable row level security;
alter table public.meal_items enable row level security;
alter table public.nutrition_estimates enable row level security;
revoke all on public.meals, public.meal_items, public.nutrition_estimates from anon, authenticated;
grant select, insert, update, delete on public.meals, public.meal_items, public.nutrition_estimates to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['meals', 'meal_items', 'nutrition_estimates'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end
$$;
