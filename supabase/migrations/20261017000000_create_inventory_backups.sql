-- Initial cloud storage for Stockroom's current single-user backup/restore flow.
-- Inventory remains local; this table stores each account's latest snapshot.
create table if not exists public.inventory_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.inventory_backups drop constraint if exists inventory_backup_shape;
alter table public.inventory_backups add constraint inventory_backup_shape check (
    jsonb_typeof(payload) = 'object'
    and payload ?& array['ingredients', 'batches', 'movements']
    and jsonb_typeof(payload -> 'ingredients') = 'array'
    and jsonb_typeof(payload -> 'batches') = 'array'
    and jsonb_typeof(payload -> 'movements') = 'array'
  );

alter table public.inventory_backups enable row level security;
revoke all on public.inventory_backups from public, anon, authenticated;
grant select, insert, update on public.inventory_backups to authenticated;

-- These names match the earlier manual setup, if it was already applied.
drop policy if exists "Read own backup" on public.inventory_backups;
drop policy if exists "Insert own backup" on public.inventory_backups;
drop policy if exists "Update own backup" on public.inventory_backups;

create policy "Read own backup" on public.inventory_backups
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own backup" on public.inventory_backups
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own backup" on public.inventory_backups
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Use the database clock even if a phone has an incorrect date/time.
create or replace function public.set_inventory_backup_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_inventory_backup_timestamp() from public, anon, authenticated;

drop trigger if exists inventory_backup_timestamp on public.inventory_backups;
create trigger inventory_backup_timestamp
  before insert or update on public.inventory_backups
  for each row execute function public.set_inventory_backup_timestamp();
