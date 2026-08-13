-- The Office Settings UI and protected configuration RPC both treat address
-- as part of an office. Make the persisted schema match that contract.
alter table public.offices
  add column if not exists address text;

update public.offices
set address = name
where nullif(btrim(address), '') is null;

notify pgrst, 'reload schema';
