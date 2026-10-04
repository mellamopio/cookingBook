create table public.cookbook_friendships (
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester_id, recipient_id),
  constraint cookbook_friendships_no_self check (requester_id <> recipient_id)
);

alter table public.cookbook_friendships enable row level security;
revoke all on table public.cookbook_friendships from public, anon, authenticated;
grant all on table public.cookbook_friendships to service_role;
