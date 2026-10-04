create table public.cookbook_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username = lower(username) and username ~ '^[a-z0-9_]{3,24}$'),
  created_at timestamptz not null default now()
);

create unique index cookbook_profiles_username_unique
  on public.cookbook_profiles (username);

alter table public.cookbook_profiles enable row level security;
revoke all on table public.cookbook_profiles from public, anon, authenticated;
grant all on table public.cookbook_profiles to service_role;
