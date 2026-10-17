-- Offline commands carry their account, original time, and reviewed allocations.
create function public.inventory_sync_command(p_owner uuid, p_id text, p_kind text, p_data jsonb, p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous public.inventory_requests%rowtype;
  item public.ingredients%rowtype;
  batch public.batches%rowtype;
  allocation jsonb;
  q numeric;
  total numeric := 0;
  payload jsonb := jsonb_build_object('data',p_data,'occurredAt',p_occurred_at);
begin
  if actor is null or p_owner is null or actor<>p_owner then raise exception 'Sign in to the account that owns these pending entries.' using errcode='42501'; end if;
  if p_id is null or length(p_id) not between 1 and 200 or p_data is null or jsonb_typeof(p_data)<>'object'
    or p_occurred_at is null or p_occurred_at>now()+interval '1 day' then raise exception 'Invalid offline entry.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into previous from public.inventory_requests where user_id=actor and id=p_id;
  if found then
    if previous.kind<>'offline:'||p_kind or previous.payload<>payload then raise exception 'Entry ID was already used.'; end if;
    return '{}'::jsonb;
  end if;
  if (p_data->>'today')::date is null or (p_data->>'today')::date>current_date+1
    or abs((p_data->>'today')::date - (p_occurred_at at time zone 'UTC')::date)>1 then
    raise exception 'Invalid offline entry date.';
  end if;
  if p_kind<>'ingredient' then
    select * into item from public.ingredients where user_id=actor and id=p_data->>'ingredientId' for update;
    if not found then raise exception 'Sync conflict: ingredient no longer exists. Pending entry was kept.'; end if;
    if p_kind='settings' and (p_data->>'expectedThreshold' is null or item.minimum_quantity<>(p_data->>'expectedThreshold')::numeric) then
      raise exception 'Sync conflict: minimum changed on another device. Pending entry was kept.';
    end if;
    if p_kind='adjust' then
      select * into batch from public.batches where user_id=actor and id=p_data->>'batchId' and ingredient_id=item.id for update;
      if not found or p_data->>'expectedQuantity' is null or batch.quantity<>(p_data->>'expectedQuantity')::numeric then
        raise exception 'Sync conflict: batch quantity changed on another device. Pending count was kept.';
      end if;
    end if;
  end if;
  if p_kind='use' then
    if jsonb_typeof(p_data->'allocations') is distinct from 'array' or jsonb_array_length(p_data->'allocations')=0 then raise exception 'Missing batch allocations.'; end if;
    if (select count(*)<>count(distinct value->>'batchId') from jsonb_array_elements(p_data->'allocations')) then raise exception 'Duplicate batch allocation.'; end if;
    insert into public.stock_entries(user_id,id,ingredient_id,kind,quantity,selection_mode,created_at)
      values(actor,p_id,item.id,'used',-(p_data->>'quantity')::numeric,case when nullif(p_data->>'batchId','') is null then 'auto' else 'manual' end,p_occurred_at);
    for allocation in select value from jsonb_array_elements(p_data->'allocations') loop
      q := (allocation->>'quantity')::numeric;
      if q is null or q<=0 or q<>round(q,3) then raise exception 'Invalid batch allocation.'; end if;
      select * into batch from public.batches where user_id=actor and id=allocation->>'batchId' and ingredient_id=item.id for update;
      if not found or batch.expiry_date<(p_data->>'today')::date
        or q>greatest(0,batch.quantity-case when nullif(p_data->>'batchId','') is null then item.minimum_quantity else 0 end)
        or (nullif(p_data->>'batchId','') is not null and batch.id<>p_data->>'batchId') then
        raise exception 'Sync conflict: reviewed batch stock is unavailable. Pending usage was kept.';
      end if;
      update public.batches set quantity=quantity-q where user_id=actor and id=batch.id;
      insert into public.stock_movements(user_id,id,entry_id,ingredient_id,batch_id,quantity,created_at)
        values(actor,p_id||':'||batch.id,p_id,item.id,batch.id,-q,p_occurred_at);
      total := total+q;
    end loop;
    if total<>(p_data->>'quantity')::numeric then raise exception 'Batch allocations do not match usage.'; end if;
  else
    perform public.inventory_apply_offline(p_id,p_kind,p_data);
    update public.stock_entries set created_at=p_occurred_at where user_id=actor and id=p_id;
    update public.stock_movements set created_at=p_occurred_at where user_id=actor and entry_id=p_id;
    if p_kind='ingredient' then update public.ingredients set created_at=p_occurred_at where user_id=actor and id=p_id; end if;
    if p_kind='receive' then update public.batches set created_at=p_occurred_at where user_id=actor and id=p_id; end if;
  end if;
  insert into public.inventory_requests(user_id,id,kind,payload) values(actor,p_id,'offline:'||p_kind,payload)
    on conflict(user_id,id) do update set kind=excluded.kind,payload=excluded.payload;
  return '{}'::jsonb;
end $$;

-- Private reuse of the existing receipt/settings/adjustment validation. Only the
-- account-bound wrapper is callable by clients, and it validates original dates.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.inventory_command_paged(text,text,jsonb)'::regprocedure);
  definition := replace(definition,'FUNCTION public.inventory_command_paged(','FUNCTION public.inventory_apply_offline(');
  definition := replace(definition,'abs(operation_date - current_date) > 1','operation_date > current_date + 1');
  execute definition;
end $$;
revoke all on function public.inventory_apply_offline(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.inventory_sync_command(uuid,text,text,jsonb,timestamptz) from public,anon;
grant execute on function public.inventory_sync_command(uuid,text,text,jsonb,timestamptz) to authenticated;
