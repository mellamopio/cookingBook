create or replace function public.find_confirmed_user_by_email(email_query text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select id
  from auth.users
  where email_confirmed_at is not null
    and lower(email) = lower(trim(email_query))
  limit 1;
$$;

revoke all on function public.find_confirmed_user_by_email(text) from public, anon, authenticated;
grant execute on function public.find_confirmed_user_by_email(text) to service_role;
