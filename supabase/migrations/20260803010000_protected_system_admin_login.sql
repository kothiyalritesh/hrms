-- Configure the designated bootstrap SYSTEM_ADMIN login without storing the
-- fixed OTP in the web client, Edge Function source, or database plaintext.

create table if not exists public.system_admin_login_credentials (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  phone text not null unique check (phone ~ '^\d{10}$'),
  otp_hash text not null check (otp_hash ~ '^[a-f0-9]{64}$'),
  salt text not null check (salt ~ '^[a-f0-9]{32,}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.system_admin_login_credentials enable row level security;
revoke all on public.system_admin_login_credentials
  from public, anon, authenticated, service_role;
grant select on public.system_admin_login_credentials to service_role;

do $$
declare
  v_profile_id uuid;
  v_count integer;
begin
  select count(*), min(profile.id::text)::uuid
  into v_count, v_profile_id
  from public.profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '\D', '', 'g')
      in ('9999999999', '919999999999')
    and profile.is_active = true
    and public.normalize_profile_role(profile.role) = 'SYSTEM_ADMIN';

  if v_count <> 1 then
    raise exception
      'PROTECTED_SYSTEM_ADMIN_LOGIN_PROFILE_MUST_MATCH_ONCE: found %',
      v_count;
  end if;

  insert into public.system_admin_login_credentials(
    profile_id,
    phone,
    otp_hash,
    salt,
    enabled
  ) values (
    v_profile_id,
    '9999999999',
    'f185c1bf38b1eaa22faa2532bd5f98f261864a3f8e5eea2f23313a359095b781',
    '161a3511bf90927f2a260dee5a87a8703ee9d6cf937dff14',
    true
  )
  on conflict (profile_id) do update
  set
    phone = excluded.phone,
    otp_hash = excluded.otp_hash,
    salt = excluded.salt,
    enabled = true,
    updated_at = now();

  if not exists (
    select 1
    from public.system_admin_login_credentials credential
    where credential.profile_id = v_profile_id
      and credential.phone = '9999999999'
      and credential.enabled = true
  ) then
    raise exception 'PROTECTED_SYSTEM_ADMIN_LOGIN_NOT_CONFIRMED';
  end if;
end;
$$;

comment on table public.system_admin_login_credentials is
  'Private salted OTP verifier for explicitly protected system administrators.';

