grant select, insert, update, delete on public.recipes to service_role;

drop policy if exists "Members can view their cookbook groups" on public.cookbook_groups;
create policy "Members can view their cookbook groups"
  on public.cookbook_groups for select
  to authenticated
  using (owner_id = auth.uid() or public.is_cookbook_group_member(id));

drop policy if exists "Group owners can add members" on public.cookbook_group_members;
create policy "Group owners can add members"
  on public.cookbook_group_members for insert
  to authenticated
  with check (
    (
      role = 'member'
      and public.is_cookbook_group_owner(group_id)
    )
    or (
      role = 'owner'
      and user_id = auth.uid()
      and public.is_cookbook_group_owner(group_id)
    )
  );
