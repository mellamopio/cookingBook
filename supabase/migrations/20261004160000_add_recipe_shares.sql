create table public.recipe_shares (
  recipe_id uuid primary key references public.recipes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  constraint recipe_shares_recipe_owner_unique unique (recipe_id, owner_id)
);

alter table public.recipe_shares enable row level security;

create policy "Owners can view their recipe share links"
  on public.recipe_shares for select
  using (auth.uid() = owner_id);

create policy "Owners can create their recipe share links"
  on public.recipe_shares for insert
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.recipes
      where recipes.id = recipe_id and recipes.user_id = auth.uid()
    )
  );

create policy "Owners can revoke their recipe share links"
  on public.recipe_shares for delete
  using (auth.uid() = owner_id);

grant usage on schema public to authenticated;
grant select, insert, delete on table public.recipe_shares to authenticated;
