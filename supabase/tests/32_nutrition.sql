-- Meals: photo ownership, unknown vs zero quantities, estimates are optional and independent.
begin;
do $$
declare
  a uuid := tests.new_user('a@example.invalid');
  b uuid := tests.new_user('b@example.invalid');
  meal uuid; item uuid; n integer;
begin
  perform tests.as_user(a);
  perform tests.throws(format('insert into public.meals (eaten_at, meal_type, photo_path) values (now(), ''lunch'', %L)', b::text || '/x.jpg'), '23514', 'photo path pointing into another user''s folder');
  perform tests.throws('insert into public.meals (eaten_at, meal_type) values (now(), ''brunch'')', '23514', 'unknown meal type');
  insert into public.meals (eaten_at, meal_type, photo_path) values (now(), 'lunch', a::text || '/2026/11/01/lunch.jpg') returning id into meal;
  insert into public.meal_items (meal_id, name) values (meal, 'arroz') returning id into item;                  -- quantity unknown
  insert into public.meal_items (meal_id, name, quantity, unit) values (meal, 'molho', 0, 'g');               -- deliberate zero
  perform tests.throws(format('insert into public.meal_items (meal_id, name, quantity) values (%L, ''x'', 5)', meal), '23514', 'quantity without unit');
  select count(*) into n from public.meal_items where quantity is null;
  perform tests.assert(n = 1, 'unknown quantity must be NULL');
  select count(*) into n from public.meal_items where quantity = 0;
  perform tests.assert(n = 1, 'zero quantity must be storable');

  perform tests.throws(format('insert into public.nutrition_estimates (meal_id, method) values (%L, ''ai'')', meal), '23514', 'estimate with no value at all');
  insert into public.nutrition_estimates (meal_id, meal_item_id, energy_kcal, protein_g, method, confidence) values (meal, item, 0, null, 'manual', 'low');
  perform tests.throws(format('insert into public.nutrition_estimates (meal_id, energy_kcal, method) values (%L, -5, ''manual'')', meal), '23514', 'negative energy');
  perform tests.throws(format('insert into public.nutrition_estimates (meal_id, energy_kcal, method) values (%L, 10, ''guess'')', meal), '23514', 'unknown estimate method');

  -- a meal of another user cannot be referenced
  perform tests.reset();
  perform tests.as_user(b);
  perform tests.throws(format('insert into public.meal_items (meal_id, name) values (%L, ''intruder'')', meal), '23503', 'item attached to another user''s meal');
  select count(*) into n from public.meals;
  perform tests.assert(n = 0, 'B sees A''s meals');
  perform tests.reset();
end
$$;
rollback;
