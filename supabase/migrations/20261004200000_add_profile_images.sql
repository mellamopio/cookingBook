insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-images', 'profile-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Users can view their own profile images"
on storage.objects for select
using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload their own profile images"
on storage.objects for insert
with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own profile images"
on storage.objects for delete
using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);
