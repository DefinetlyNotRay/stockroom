-- Explicit one-time transfer of legacy phone data into an empty account.
create function public.inventory_import(p_inventory jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  record jsonb;
  previous jsonb;
  difference numeric;
begin
  if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if p_inventory is null or jsonb_typeof(p_inventory) <> 'object'
     or not p_inventory ?& array['ingredients','batches','movements']
     or jsonb_typeof(p_inventory->'ingredients') <> 'array'
     or jsonb_typeof(p_inventory->'batches') <> 'array'
     or jsonb_typeof(p_inventory->'movements') <> 'array' then raise exception 'Invalid phone inventory.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select payload into previous from public.inventory_requests where user_id=actor and id='legacy-phone-import';
  if found then
    if previous <> p_inventory then raise exception 'Phone inventory was already imported.'; end if;
    return public.inventory_read();
  end if;
  if exists(select 1 from public.ingredients where user_id=actor) then raise exception 'Import requires an empty cloud account.'; end if;
  for record in select value from jsonb_array_elements(p_inventory->'ingredients') loop
    insert into public.ingredients(user_id,id,name,unit,minimum_quantity)
    values(actor,record->>'id',record->>'name',record->>'unit',(record->>'threshold')::numeric);
  end loop;
  for record in select value from jsonb_array_elements(p_inventory->'batches') loop
    insert into public.batches(user_id,id,ingredient_id,code,received_date,expiry_date,quantity)
    values(actor,record->>'id',record->>'ingredientId',record->>'code',(record->>'received')::date,(record->>'expiry')::date,(record->>'quantity')::numeric);
  end loop;
  for record in select value from jsonb_array_elements(p_inventory->'movements') loop
    insert into public.stock_entries(user_id,id,ingredient_id,kind,quantity,reason,created_at)
    values(actor,record->>'id',record->>'ingredientId',record->>'type',(record->>'quantity')::numeric,record->>'reason',(record->>'date')::timestamptz);
    insert into public.stock_movements(user_id,id,entry_id,ingredient_id,batch_id,quantity,created_at)
    values(actor,record->>'id',record->>'id',record->>'ingredientId',record->>'batchId',(record->>'quantity')::numeric,(record->>'date')::timestamptz);
  end loop;
  for record in select value from jsonb_array_elements(p_inventory->'batches') loop
    select (record->>'quantity')::numeric-coalesce(sum(quantity),0) into difference
    from public.stock_movements where user_id=actor and batch_id=record->>'id';
    if difference <> 0 then
      insert into public.stock_entries(user_id,id,ingredient_id,kind,quantity,reason)
      values(actor,'opening:'||(record->>'id'),record->>'ingredientId','adjusted',difference,'Imported opening balance');
      insert into public.stock_movements(user_id,entry_id,ingredient_id,batch_id,quantity)
      values(actor,'opening:'||(record->>'id'),record->>'ingredientId',record->>'id',difference);
    end if;
  end loop;
  insert into public.inventory_requests(user_id,id,kind,payload) values(actor,'legacy-phone-import','import',p_inventory);
  return public.inventory_read();
end;
$$;
revoke all on function public.inventory_import(jsonb) from public, anon;
grant execute on function public.inventory_import(jsonb) to authenticated;
