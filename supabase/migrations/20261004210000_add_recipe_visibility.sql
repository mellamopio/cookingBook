alter table public.recipes
  add column visibility text not null default 'private'
  check (visibility in ('private', 'friends', 'public'));

grant usage on schema public to anon;
grant select on table public.recipes to anon;

create index recipes_public_created_at_idx
  on public.recipes (created_at desc)
  where visibility = 'public';

create or replace function public.are_cookbook_friends(recipe_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.cookbook_friendships friendship
      where friendship.status = 'accepted'
        and (
          (friendship.requester_id = auth.uid() and friendship.recipient_id = recipe_owner_id)
          or (friendship.recipient_id = auth.uid() and friendship.requester_id = recipe_owner_id)
        )
    );
$$;

revoke all on function public.are_cookbook_friends(uuid) from public, anon, authenticated;
grant execute on function public.are_cookbook_friends(uuid) to anon, authenticated;

create policy "Anyone can view public recipes"
  on public.recipes for select
  using (visibility = 'public');

create policy "Friends can view friends-only recipes"
  on public.recipes for select
  using (visibility = 'friends' and public.are_cookbook_friends(user_id));
