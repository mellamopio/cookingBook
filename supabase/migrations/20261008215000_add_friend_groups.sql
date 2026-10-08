create table public.cookbook_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.cookbook_group_members (
  group_id uuid not null references public.cookbook_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.cookbook_group_recipe_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.cookbook_groups(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  comment text not null check (char_length(btrim(comment)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index cookbook_group_members_user_idx
  on public.cookbook_group_members (user_id, added_at desc);
create index cookbook_group_posts_feed_idx
  on public.cookbook_group_recipe_posts (group_id, created_at desc);
create index cookbook_group_posts_recipe_idx
  on public.cookbook_group_recipe_posts (recipe_id, group_id);

alter table public.cookbook_groups enable row level security;
alter table public.cookbook_group_members enable row level security;
alter table public.cookbook_group_recipe_posts enable row level security;

grant select, insert, update, delete on public.cookbook_groups to authenticated;
grant select, insert, delete on public.cookbook_group_members to authenticated;
grant select, insert, delete on public.cookbook_group_recipe_posts to authenticated;

create or replace function public.is_cookbook_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.cookbook_group_members member
    where member.group_id = target_group_id
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.is_cookbook_group_owner(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.cookbook_groups cookbook_group
    where cookbook_group.id = target_group_id
      and cookbook_group.owner_id = auth.uid()
  );
$$;

create or replace function public.is_recipe_shared_with_group(target_recipe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.cookbook_group_recipe_posts post
    join public.cookbook_group_members member on member.group_id = post.group_id
    where post.recipe_id = target_recipe_id
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.can_share_cookbook_recipe(target_recipe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.recipes recipe
    where recipe.id = target_recipe_id
      and recipe.user_id = auth.uid()
  );
$$;

revoke all on function public.is_cookbook_group_member(uuid) from public, anon;
revoke all on function public.is_cookbook_group_owner(uuid) from public, anon;
revoke all on function public.is_recipe_shared_with_group(uuid) from public, anon;
revoke all on function public.can_share_cookbook_recipe(uuid) from public, anon;
grant execute on function public.is_cookbook_group_member(uuid) to authenticated;
grant execute on function public.is_cookbook_group_owner(uuid) to authenticated;
grant execute on function public.is_recipe_shared_with_group(uuid) to authenticated;
grant execute on function public.can_share_cookbook_recipe(uuid) to authenticated;

create or replace function public.add_cookbook_group_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cookbook_group_members (group_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger add_cookbook_group_owner_member
  after insert on public.cookbook_groups
  for each row execute function public.add_cookbook_group_owner();

create policy "Members can view their cookbook groups"
  on public.cookbook_groups for select
  to authenticated
  using (public.is_cookbook_group_member(id));
create policy "Users can create cookbook groups"
  on public.cookbook_groups for insert
  to authenticated
  with check (auth.uid() = owner_id);
create policy "Group owners can rename their groups"
  on public.cookbook_groups for update
  to authenticated
  using (public.is_cookbook_group_owner(id))
  with check (public.is_cookbook_group_owner(id));
create policy "Group owners can delete their groups"
  on public.cookbook_groups for delete
  to authenticated
  using (public.is_cookbook_group_owner(id));

create policy "Group members can view group membership"
  on public.cookbook_group_members for select
  to authenticated
  using (public.is_cookbook_group_member(group_id));
create policy "Group owners can add members"
  on public.cookbook_group_members for insert
  to authenticated
  with check (
    role = 'member'
    and public.is_cookbook_group_owner(group_id)
  );
create policy "Group owners can remove members and members can leave"
  on public.cookbook_group_members for delete
  to authenticated
  using (
    (user_id = auth.uid() and role = 'member')
    or (user_id <> auth.uid() and public.is_cookbook_group_owner(group_id))
  );

create policy "Group members can view recipe activity"
  on public.cookbook_group_recipe_posts for select
  to authenticated
  using (public.is_cookbook_group_member(group_id));
create policy "Members can share recipes in their groups"
  on public.cookbook_group_recipe_posts for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_cookbook_group_member(group_id)
    and public.can_share_cookbook_recipe(recipe_id)
  );
create policy "Authors and group owners can remove recipe activity"
  on public.cookbook_group_recipe_posts for delete
  to authenticated
  using (user_id = auth.uid() or public.is_cookbook_group_owner(group_id));

create policy "Group members can view recipes shared with their groups"
  on public.recipes for select
  to authenticated
  using (public.is_recipe_shared_with_group(id));

create policy "Group members can view comments on shared recipes"
  on public.recipe_comments for select
  to authenticated
  using (
    exists (
      select 1 from public.recipes recipe
      where recipe.id = recipe_id
        and public.is_recipe_shared_with_group(recipe.id)
    )
  );
create policy "Group members can comment on shared recipes"
  on public.recipe_comments for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.recipes recipe
      where recipe.id = recipe_id
        and public.is_recipe_shared_with_group(recipe.id)
    )
  );
create policy "Group members can edit comments on shared recipes"
  on public.recipe_comments for update
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.recipes recipe
      where recipe.id = recipe_id
        and public.is_recipe_shared_with_group(recipe.id)
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.recipes recipe
      where recipe.id = recipe_id
        and public.is_recipe_shared_with_group(recipe.id)
    )
  );

create policy "Group members can view ratings on shared recipes"
  on public.recipe_ratings for select
  to authenticated
  using (public.is_recipe_shared_with_group(recipe_id));
create policy "Group members can rate shared recipes"
  on public.recipe_ratings for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_recipe_shared_with_group(recipe_id));
create policy "Group members can save shared recipes"
  on public.recipe_saves for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_recipe_shared_with_group(recipe_id));
create policy "Group members can track shared recipes"
  on public.recipe_views for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_recipe_shared_with_group(recipe_id));

create policy "Group members can view source pages for shared recipes"
  on public.recipe_source_images for select
  to authenticated
  using (public.is_recipe_shared_with_group(recipe_id));
create policy "Group members can view cover images for shared recipes"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and exists (
      select 1
      from public.recipes recipe
      where recipe.image_path = storage.objects.name
        and public.is_recipe_shared_with_group(recipe.id)
    )
  );
create policy "Group members can view original pages for shared recipes"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recipe-source-images'
    and exists (
      select 1
      from public.recipe_source_images source
      where source.image_path = storage.objects.name
        and public.is_recipe_shared_with_group(source.recipe_id)
    )
  );
create policy "Group members can view comment images on shared recipes"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'comment-images'
    and exists (
      select 1
      from public.recipe_comments comment
      where comment.image_path = storage.objects.name
        and public.is_recipe_shared_with_group(comment.recipe_id)
    )
  );
