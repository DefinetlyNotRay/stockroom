-- Bounded reads; retain legacy endpoints for installed clients.
create function public.inventory_page(p_offset integer default 0, p_limit integer default 200)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'ingredients', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id,name,unit,minimum_quantity as threshold from public.ingredients
      where user_id=auth.uid() order by id limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)
    ) x),'[]'::jsonb),
    'batches', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id,ingredient_id as "ingredientId",code,received_date as received,expiry_date as expiry,quantity
      from public.batches where user_id=auth.uid() order by id
      limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)
    ) x),'[]'::jsonb)
  );
$$;

create function public.inventory_history_page(
  p_offset integer default 0, p_limit integer default 25,
  p_ingredient text default null, p_search text default '',
  p_from timestamptz default null, p_to timestamptz default null,
  p_oldest boolean default false
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
    select m.id,m.ingredient_id as "ingredientId",m.batch_id as "batchId",b.code as batch,
      m.quantity,e.kind as type,m.created_at as date,coalesce(e.reason,'') as reason
    from public.stock_movements m
    join public.batches b on (b.user_id,b.id)=(m.user_id,m.batch_id)
    join public.stock_entries e on (e.user_id,e.id)=(m.user_id,m.entry_id)
    join public.ingredients i on (i.user_id,i.id)=(m.user_id,m.ingredient_id)
    where m.user_id=auth.uid()
      and (p_ingredient is null or m.ingredient_id=p_ingredient)
      and (coalesce(p_search,'')='' or strpos(lower(i.name),lower(p_search))>0)
      and (p_from is null or m.created_at>=p_from)
      and (p_to is null or m.created_at<p_to)
    order by
      case when p_oldest then m.created_at end asc,
      case when not p_oldest then m.created_at end desc,
      case when p_oldest then m.id end asc,
      case when not p_oldest then m.id end desc
    limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)
  ) x;
$$;

-- Reuse the same validated transaction logic without serializing all history
-- after every edit. The original command remains available to older APKs.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.inventory_command(text,text,jsonb)'::regprocedure);
  definition := replace(definition, 'FUNCTION public.inventory_command(', 'FUNCTION public.inventory_command_paged(');
  definition := replace(definition, 'return public.inventory_read();', 'return ''{}''::jsonb;');
  execute definition;
  definition := pg_get_functiondef('public.inventory_import(jsonb)'::regprocedure);
  definition := replace(definition, 'FUNCTION public.inventory_import(', 'FUNCTION public.inventory_import_paged(');
  definition := replace(definition, 'return public.inventory_read();', 'return ''{}''::jsonb;');
  execute definition;
end $$;

create index movements_ingredient_history on public.stock_movements(user_id,ingredient_id,created_at desc,id desc);
create index movements_history_page on public.stock_movements(user_id,created_at desc,id desc);
revoke all on function public.inventory_page(integer,integer),
  public.inventory_history_page(integer,integer,text,text,timestamptz,timestamptz,boolean),
  public.inventory_command_paged(text,text,jsonb), public.inventory_import_paged(jsonb) from public,anon;
grant execute on function public.inventory_page(integer,integer),
  public.inventory_history_page(integer,integer,text,text,timestamptz,timestamptz,boolean),
  public.inventory_command_paged(text,text,jsonb), public.inventory_import_paged(jsonb) to authenticated;
