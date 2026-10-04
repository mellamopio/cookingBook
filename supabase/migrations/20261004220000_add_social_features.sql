create table public.cookbook_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint cookbook_follows_no_self check (follower_id <> followed_id)
);

create index cookbook_follows_followed_idx on public.cookbook_follows (followed_id, created_at desc);
alter table public.cookbook_follows enable row level security;
grant select, insert, delete on public.cookbook_follows to authenticated;

create policy "Users can view follower relationships"
  on public.cookbook_follows for select
  using (auth.uid() = follower_id or auth.uid() = followed_id);
create policy "Users can follow accounts"
  on public.cookbook_follows for insert
  with check (auth.uid() = follower_id);
create policy "Users can unfollow accounts"
  on public.cookbook_follows for delete
  using (auth.uid() = follower_id);

create table public.recipe_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create index recipe_saves_recipe_idx on public.recipe_saves (recipe_id, created_at desc);
alter table public.recipe_saves enable row level security;
grant select, insert, delete on public.recipe_saves to authenticated;

create policy "Users can view their own saved recipes"
  on public.recipe_saves for select
  using (auth.uid() = user_id);
create policy "Users can save recipes they can view"
  on public.recipe_saves for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id = auth.uid() or visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Users can remove their saved recipes"
  on public.recipe_saves for delete
  using (auth.uid() = user_id);

create table public.recipe_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create index recipe_ratings_recipe_idx on public.recipe_ratings (recipe_id);
alter table public.recipe_ratings enable row level security;
grant select, insert, update, delete on public.recipe_ratings to authenticated;
grant select on public.recipe_ratings to anon;

create policy "Ratings are visible for readable recipes"
  on public.recipe_ratings for select
  using (
    exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id = auth.uid() or visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Users can rate recipes they can view"
  on public.recipe_ratings for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id <> auth.uid())
        and (visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Users can update their own recipe ratings"
  on public.recipe_ratings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can remove their own recipe ratings"
  on public.recipe_ratings for delete
  using (auth.uid() = user_id);

create table public.recipe_comments (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipe_comments_recipe_idx on public.recipe_comments (recipe_id, created_at);
alter table public.recipe_comments enable row level security;
grant select, insert, delete on public.recipe_comments to authenticated;
grant update (body, updated_at) on public.recipe_comments to authenticated;
grant select on public.recipe_comments to anon;

create policy "Comments are visible for readable recipes"
  on public.recipe_comments for select
  using (
    exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id = auth.uid() or visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Users can comment on readable recipes"
  on public.recipe_comments for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id = auth.uid() or visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Authors can edit their comments"
  on public.recipe_comments for update
  using (
    auth.uid() = user_id
    or exists (select 1 from public.recipes where id = recipe_id and user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id = auth.uid() or visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Authors and recipe owners can delete comments"
  on public.recipe_comments for delete
  using (
    auth.uid() = user_id
    or exists (select 1 from public.recipes where id = recipe_id and user_id = auth.uid())
  );

create table public.recipe_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create index recipe_views_recent_idx on public.recipe_views (user_id, viewed_at desc);
alter table public.recipe_views enable row level security;
grant select, insert, update, delete on public.recipe_views to authenticated;

create policy "Users can view their own recipe history"
  on public.recipe_views for select
  using (auth.uid() = user_id);
create policy "Users can track recipes they can view"
  on public.recipe_views for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.recipes
      where id = recipe_id
        and (user_id = auth.uid() or visibility = 'public' or (visibility = 'friends' and public.are_cookbook_friends(user_id)))
    )
  );
create policy "Users can update their own recipe history"
  on public.recipe_views for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can clear their own recipe history"
  on public.recipe_views for delete
  using (auth.uid() = user_id);

create table public.cookbook_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('friend_request', 'friend_accepted', 'follow', 'comment', 'rating', 'save')),
  recipe_id uuid references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index cookbook_notifications_recipient_idx on public.cookbook_notifications (recipient_id, created_at desc);
alter table public.cookbook_notifications enable row level security;
grant select on public.cookbook_notifications to authenticated;
grant update (read_at) on public.cookbook_notifications to authenticated;

create policy "Users can view their own notifications"
  on public.cookbook_notifications for select
  using (auth.uid() = recipient_id);
create policy "Users can mark their own notifications read"
  on public.cookbook_notifications for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comment-images', 'comment-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Users can view comment images for readable recipes"
  on storage.objects for select
  using (
    bucket_id = 'comment-images'
    and exists (
      select 1 from public.recipe_comments comment
      join public.recipes recipe on recipe.id = comment.recipe_id
      where comment.image_path = storage.objects.name
        and (recipe.user_id = auth.uid() or recipe.visibility = 'public' or (recipe.visibility = 'friends' and public.are_cookbook_friends(recipe.user_id)))
    )
  );
create policy "Users can upload comment images in their folder"
  on storage.objects for insert
  with check (bucket_id = 'comment-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete their own comment images"
  on storage.objects for delete
  using (bucket_id = 'comment-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Recipe owners can delete comment images"
  on storage.objects for delete
  using (
    bucket_id = 'comment-images'
    and exists (
      select 1 from public.recipe_comments comment
      join public.recipes recipe on recipe.id = comment.recipe_id
      where comment.image_path = storage.objects.name
        and recipe.user_id = auth.uid()
    )
  );

create policy "Users can read images for recipes they can view"
  on storage.objects for select
  using (
    bucket_id = 'recipe-images'
    and exists (
      select 1 from public.recipes recipe
      where recipe.image_path = storage.objects.name
        and (recipe.user_id = auth.uid() or recipe.visibility = 'public' or (recipe.visibility = 'friends' and public.are_cookbook_friends(recipe.user_id)))
    )
  );

create policy "Users can read public usernames"
  on public.cookbook_profiles for select
  using (true);
grant select on public.cookbook_profiles to anon, authenticated;

create or replace function public.notify_social_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient uuid;
  actor uuid;
  event_name text;
  recipe uuid;
begin
  if tg_table_name = 'cookbook_friendships' then
    actor := new.requester_id;
    if tg_op = 'INSERT' then
      recipient := new.recipient_id;
      event_name := 'friend_request';
    elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
      recipient := new.requester_id;
      actor := new.recipient_id;
      event_name := 'friend_accepted';
    else
      return new;
    end if;
  elsif tg_table_name = 'cookbook_follows' then
    recipient := new.followed_id;
    actor := new.follower_id;
    event_name := 'follow';
  elsif tg_table_name = 'recipe_comments' then
    select user_id into recipient from public.recipes where id = new.recipe_id;
    actor := new.user_id;
    event_name := 'comment';
    recipe := new.recipe_id;
  elsif tg_table_name = 'recipe_ratings' then
    select user_id into recipient from public.recipes where id = new.recipe_id;
    actor := new.user_id;
    event_name := 'rating';
    recipe := new.recipe_id;
  elsif tg_table_name = 'recipe_saves' then
    select user_id into recipient from public.recipes where id = new.recipe_id;
    actor := new.user_id;
    event_name := 'save';
    recipe := new.recipe_id;
  end if;
  if recipient is not null and recipient <> actor then
    insert into public.cookbook_notifications (recipient_id, actor_id, event_type, recipe_id)
    values (recipient, actor, event_name, recipe);
  end if;
  return new;
end;
$$;

create trigger notify_friendship_events
  after insert or update of status on public.cookbook_friendships
  for each row execute function public.notify_social_event();
create trigger notify_follow_events
  after insert on public.cookbook_follows
  for each row execute function public.notify_social_event();
create trigger notify_recipe_comment_events
  after insert on public.recipe_comments
  for each row execute function public.notify_social_event();
create trigger notify_recipe_rating_events
  after insert on public.recipe_ratings
  for each row execute function public.notify_social_event();
create trigger notify_recipe_save_events
  after insert on public.recipe_saves
  for each row execute function public.notify_social_event();
