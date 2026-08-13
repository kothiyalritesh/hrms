-- Profile pictures contain employee identity data. Keep the bucket private and
-- allow each authenticated employee to access only their own object.
insert into storage.buckets (id, name, public)
values ('profile-pics', 'profile-pics', false)
on conflict (id) do update set public = false;

-- Convert legacy public object URLs to the private object path expected by the
-- client. Query strings from old cache-busting URLs are removed.
update public.profiles
set avatar = split_part(split_part(avatar, '/profile-pics/', 2), '?', 1)
where avatar like '%/profile-pics/%';

drop policy if exists "Public read profile pics" on storage.objects;
drop policy if exists "profile-pics public read" on storage.objects;
drop policy if exists "Users read own avatar" on storage.objects;
drop policy if exists "Users upload own avatar" on storage.objects;
drop policy if exists "profile-pics user upload" on storage.objects;
drop policy if exists "Users update own avatar" on storage.objects;
drop policy if exists "profile-pics user update" on storage.objects;
drop policy if exists "profile-pics own read" on storage.objects;
drop policy if exists "profile-pics own insert" on storage.objects;
drop policy if exists "profile-pics own update" on storage.objects;
drop policy if exists "profile-pics own delete" on storage.objects;

create policy "profile-pics own read"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-pics'
  and (storage.foldername(name))[1] = 'avatars'
  and split_part(storage.filename(name), '.', 1) = auth.uid()::text
);

create policy "profile-pics own insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-pics'
  and (storage.foldername(name))[1] = 'avatars'
  and split_part(storage.filename(name), '.', 1) = auth.uid()::text
);

create policy "profile-pics own update"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-pics'
  and (storage.foldername(name))[1] = 'avatars'
  and split_part(storage.filename(name), '.', 1) = auth.uid()::text
)
with check (
  bucket_id = 'profile-pics'
  and (storage.foldername(name))[1] = 'avatars'
  and split_part(storage.filename(name), '.', 1) = auth.uid()::text
);

create policy "profile-pics own delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-pics'
  and (storage.foldername(name))[1] = 'avatars'
  and split_part(storage.filename(name), '.', 1) = auth.uid()::text
);
