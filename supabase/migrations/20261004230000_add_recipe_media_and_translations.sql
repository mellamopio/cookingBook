create table public.cookbook_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'de', 'es')),
  updated_at timestamptz not null default now()
);

alter table public.cookbook_preferences enable row level security;
grant select, insert, update on public.cookbook_preferences to authenticated;
create policy "Users can manage their own cookbook preferences"
  on public.cookbook_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.recipe_source_images (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null unique,
  position smallint not null check (position between 0 and 9),
  created_at timestamptz not null default now(),
  unique (recipe_id, position)
);

create index recipe_source_images_recipe_idx on public.recipe_source_images (recipe_id, position);
alter table public.recipe_source_images enable row level security;
grant select, insert, delete on public.recipe_source_images to authenticated;
grant select on public.recipe_source_images to anon;

create policy "Source pages are visible with their recipe"
  on public.recipe_source_images for select
  using (
    exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id = auth.uid() or visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Recipe owners can add source pages"
  on public.recipe_source_images for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.recipes where id = recipe_id and user_id = auth.uid())
  );
create policy "Recipe owners can remove source pages"
  on public.recipe_source_images for delete
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-source-images', 'recipe-source-images', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "Users can upload recipe source pages in their folder"
  on storage.objects for insert
  with check (bucket_id = 'recipe-source-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can view source pages for readable recipes"
  on storage.objects for select
  using (
    bucket_id = 'recipe-source-images'
    and exists (
      select 1 from public.recipe_source_images source
      join public.recipes recipe on recipe.id = source.recipe_id
      where source.image_path = storage.objects.name
        and (recipe.user_id = auth.uid() or recipe.visibility = 'public' or (recipe.visibility = 'friends' and public.are_cookbook_friends(recipe.user_id)))
    )
  );
create policy "Users can delete their recipe source pages"
  on storage.objects for delete
  using (bucket_id = 'recipe-source-images' and (storage.foldername(name))[1] = auth.uid()::text);

create table public.recipe_translations (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (language in ('en', 'de', 'es')),
  translation jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (recipe_id, user_id, language)
);

alter table public.recipe_translations enable row level security;
grant select, insert, update, delete on public.recipe_translations to authenticated;

create policy "Users can view their own recipe translations"
  on public.recipe_translations for select
  using (auth.uid() = user_id);
create policy "Users can save translations for readable recipes"
  on public.recipe_translations for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id = auth.uid() or visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Users can update their own recipe translations"
  on public.recipe_translations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can delete their own recipe translations"
  on public.recipe_translations for delete
  using (auth.uid() = user_id);
