-- Abatement Link v2.16 serial takeover patch
-- Lets a user add a Not Verified device claim even when the serial already exists.
-- Verification then asks whether previous data should be kept or deleted.

alter table public.devices drop constraint if exists devices_serial_number_key;
drop index if exists devices_serial_number_key;

alter table public.devices
  add column if not exists pending_takeover boolean not null default false,
  add column if not exists takeover_finalized_at timestamptz;

create index if not exists idx_devices_serial_number on public.devices(serial_number);
create index if not exists idx_devices_owner_serial on public.devices(owner_id, serial_number);
