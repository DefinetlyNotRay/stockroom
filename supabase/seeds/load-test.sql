-- Run deliberately with: npx supabase db query --linked --file supabase/seeds/load-test.sql
-- Additive, account-specific and safe to rerun. Not a production migration.
begin;
do $$
declare
  actor uuid := '50445eb6-e717-4a70-b9fb-bc3b71ea96c6';
  prefix constant text := 'stockroom-loadtest-v1-';
begin
  if not exists (select 1 from auth.users where id = actor) then
    raise exception 'Load-test account does not exist.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  if exists (select 1 from public.ingredients where user_id = actor and id like prefix || '%') then
    raise notice 'Load-test data already exists; leaving it unchanged.';
    return;
  end if;

  insert into public.ingredients(user_id, id, name, unit, minimum_quantity, created_at)
  select actor, prefix || 'ingredient-' || n,
    'MOCK · ' || (array['Rice','Flour','Sugar','Salt','Coffee','Tea','Milk','Butter','Cheese','Yogurt',
      'Tomato','Onion','Garlic','Potato','Carrot','Pepper','Chicken','Beef','Fish','Eggs',
      'Soy sauce','Cooking oil','Pasta','Oats','Beans','Lentils','Cocoa','Honey','Cream','Corn'])[1 + (n-1)%30]
      || ' · Variant ' || lpad(((n-1)/30+1)::text, 2, '0'),
    (array['kg','L','pcs'])[1 + (n-1)%3], 5 + n%16,
    (current_date - 200)::timestamptz + n * interval '1 minute'
  from generate_series(1, 300) as g(n);

  create temporary table mock_load_batches on commit drop as
  select actor as user_id,
    prefix || 'ingredient-' || n as ingredient_id,
    prefix || 'batch-' || n || '-' || b as id,
    'MOCK-' || lpad(n::text, 3, '0') || '-' || b as code,
    current_date - (90 + b*12 + n%20) as received,
    current_date + case when b=1 then -3-n%30 when b=2 then 1+n%7 else 30+b*15+n%60 end as expiry,
    (array[0,2,15,80,150,250])[1+(n+b)%6]::numeric as final_quantity,
    (200 + n%10)::numeric as receipt_quantity
  from generate_series(1, 300) as ingredients(n)
  cross join generate_series(1, 6) as batches(b);

  insert into public.batches(user_id,id,ingredient_id,code,received_date,expiry_date,quantity,created_at)
  select user_id,id,ingredient_id,code,received,expiry,final_quantity,received::timestamptz + interval '8 hours'
  from mock_load_batches;

  create temporary table mock_load_movements on commit drop as
  select b.*, b.id || '-event-' || step as event_id,
    case when step=0 then 'received' when step=7 then 'adjusted' else 'used' end as kind,
    case when step=0 then receipt_quantity when step=7 then final_quantity-(receipt_quantity-60) else -10 end as delta,
    received::timestamptz + step * interval '1 day' + interval '8 hours' as event_time
  from mock_load_batches b cross join generate_series(0,7) as events(step);

  insert into public.stock_entries(user_id,id,ingredient_id,kind,quantity,reason,selection_mode,created_at)
  select user_id,event_id,ingredient_id,kind,delta,
    case when kind='adjusted' then 'MOCK: physical stock count'
      when kind='used' then 'MOCK: kitchen preparation' else 'MOCK: supplier delivery' end,
    case when kind='used' then 'manual' end,event_time
  from mock_load_movements;

  insert into public.stock_movements(user_id,id,entry_id,ingredient_id,batch_id,quantity,created_at)
  select user_id,event_id,event_id,ingredient_id,id,delta,event_time from mock_load_movements;
end $$;
commit;
