-- A reviewed count is one transaction, including unchanged counted batches.
create function public.inventory_sync_opname(p_owner uuid, p_id text, p_kind text, p_data jsonb, p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous public.inventory_requests%rowtype;
  batch public.batches%rowtype;
  entry jsonb;
  q numeric;
  expected numeric;
  difference numeric;
  entry_id text;
  payload jsonb := jsonb_build_object('data',p_data,'occurredAt',p_occurred_at);
begin
  if actor is null or p_owner is null or actor<>p_owner then raise exception 'Sign in to the account that owns this count.' using errcode='42501'; end if;
  if p_kind is distinct from 'opname' or p_id is null or length(p_id) not between 1 and 200
    or jsonb_typeof(p_data) is distinct from 'object' or p_occurred_at is null or p_occurred_at>now()+interval '1 day'
    then raise exception 'Invalid count request.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into previous from public.inventory_requests where user_id=actor and id=p_id;
  if found then
    if previous.kind<>'offline:opname' or previous.payload<>payload then raise exception 'Count ID was already used.'; end if;
    return '{}'::jsonb;
  end if;
  if nullif(trim(p_data->>'reason'),'') is null or jsonb_typeof(p_data->'entries') is distinct from 'array' then raise exception 'Missing reason or counts.'; end if;
  if jsonb_array_length(p_data->'entries')=0 or
    (select count(*)<>count(distinct value->>'batchId') from jsonb_array_elements(p_data->'entries'))
    then raise exception 'Missing or duplicate batches.'; end if;
  for entry in select value from jsonb_array_elements(p_data->'entries') loop
    q := (entry->>'quantity')::numeric;
    expected := (entry->>'expectedQuantity')::numeric;
    if q is null or q not between 0 and 1000000000000 or q<>round(q,3) or expected is null then raise exception 'Invalid physical count.'; end if;
    select * into batch from public.batches where user_id=actor and id=entry->>'batchId' and ingredient_id=entry->>'ingredientId' for update;
    if not found or batch.quantity<>expected then
      raise exception 'Sync conflict: stock changed for batch %. Entire count was kept pending; no batches were adjusted.', entry->>'batchId';
    end if;
    difference := q-expected;
    if difference<>0 then
      entry_id := p_id||':'||batch.id;
      insert into public.stock_entries(user_id,id,ingredient_id,kind,quantity,reason,created_at)
        values(actor,entry_id,batch.ingredient_id,'adjusted',difference,trim(p_data->>'reason')||' ['||p_id||']',p_occurred_at);
      insert into public.stock_movements(user_id,id,entry_id,ingredient_id,batch_id,quantity,created_at)
        values(actor,entry_id,entry_id,batch.ingredient_id,batch.id,difference,p_occurred_at);
      update public.batches set quantity=q where user_id=actor and id=batch.id;
    end if;
  end loop;
  insert into public.inventory_requests(user_id,id,kind,payload) values(actor,p_id,'offline:opname',payload);
  return '{}'::jsonb;
end $$;
revoke all on function public.inventory_sync_opname(uuid,text,text,jsonb,timestamptz) from public,anon;
grant execute on function public.inventory_sync_opname(uuid,text,text,jsonb,timestamptz) to authenticated;
