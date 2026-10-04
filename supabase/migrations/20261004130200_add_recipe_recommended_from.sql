alter table public.recipes
  add column if not exists recommended_from text;
