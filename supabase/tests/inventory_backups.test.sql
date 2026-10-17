begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_table('public', 'inventory_backups', 'Backup table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.inventory_backups'::regclass), 'RLS is enabled');
select ok(not has_table_privilege('anon', 'public.inventory_backups', 'SELECT'), 'Anonymous users cannot read backups');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'manager-a@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'manager-b@example.test');

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
select lives_ok($sql$
  insert into public.inventory_backups (user_id, payload)
  values ('00000000-0000-0000-0000-000000000001', '{"ingredients":[],"batches":[],"movements":[]}');
$sql$, 'Manager A can save their backup');
select is((select count(*) from public.inventory_backups), 1::bigint, 'Manager A sees their backup');

set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
select is((select count(*) from public.inventory_backups), 0::bigint, 'Manager B cannot read manager A backup');
select throws_ok($sql$
  insert into public.inventory_backups (user_id, payload)
  values ('00000000-0000-0000-0000-000000000001', '{"ingredients":[],"batches":[],"movements":[]}');
$sql$, '42501', null, 'Cannot insert a backup for another account');
select lives_ok($sql$
  insert into public.inventory_backups (user_id, payload)
  values ('00000000-0000-0000-0000-000000000002', '{"ingredients":[],"batches":[],"movements":[]}');
$sql$, 'Manager B can save their own backup');
with changed as (
  update public.inventory_backups set payload = '{"ingredients":[],"batches":[],"movements":[]}'
  where user_id = '00000000-0000-0000-0000-000000000001' returning user_id
) select is(count(*), 0::bigint, 'Cannot update another account backup') from changed;
select throws_ok($sql$
  update public.inventory_backups set payload = '{}'
  where user_id = '00000000-0000-0000-0000-000000000002';
$sql$, '23514', null, 'Rejects malformed snapshots');
select throws_ok($sql$delete from public.inventory_backups;$sql$, '42501', null, 'App cannot delete backups');

reset role;
select * from finish();
rollback;
