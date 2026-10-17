-- Normalized inventory database. The earlier backup table remains as legacy data.
create table public.ingredients (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null check (length(trim(name)) between 1 and 160),
  unit text not null check (length(trim(unit)) between 1 and 24),
  minimum_quantity numeric(18,3) not null default 0 check (minimum_quantity between 0 and 1000000000000),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index ingredients_unique_name on public.ingredients(user_id, lower(trim(name)));

create table public.batches (
  user_id uuid not null,
  id text not null default gen_random_uuid()::text,
  ingredient_id text not null,
  code text not null check (length(trim(code)) between 1 and 160),
  received_date date not null,
  expiry_date date not null check (expiry_date >= received_date),
  quantity numeric(18,3) not null default 0 check (quantity between 0 and 1000000000000),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, ingredient_id, id),
  foreign key (user_id, ingredient_id) references public.ingredients(user_id, id) on delete cascade
);
create unique index batches_unique_code on public.batches(user_id, ingredient_id, lower(trim(code)));
create index batches_fifo on public.batches(user_id, ingredient_id, received_date, created_at, id);
create index batches_expiry on public.batches(user_id, expiry_date) where quantity > 0;

-- One entry can use multiple batches. Movements are the individual allocations.
create table public.stock_entries (
  user_id uuid not null,
  id text not null,
  ingredient_id text not null,
  kind text not null check (kind in ('received', 'used', 'adjusted')),
  quantity numeric(18,3) not null check (quantity <> 0 and quantity between -1000000000000 and 1000000000000),
  reason text,
  selection_mode text check (selection_mode in ('auto', 'manual')),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, ingredient_id, id),
  foreign key (user_id, ingredient_id) references public.ingredients(user_id, id) on delete cascade,
  check (kind <> 'adjusted' or length(trim(reason)) > 0 and reason is not null),
  check (kind <> 'received' or quantity > 0),
  check (kind <> 'used' or quantity < 0)
);
create index entries_history on public.stock_entries(user_id, created_at desc);

create table public.stock_movements (
  user_id uuid not null,
  id text not null default gen_random_uuid()::text,
  entry_id text not null,
  ingredient_id text not null,
  batch_id text not null,
  quantity numeric(18,3) not null check (quantity <> 0 and quantity between -1000000000000 and 1000000000000),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, ingredient_id, entry_id) references public.stock_entries(user_id, ingredient_id, id) on delete cascade,
  foreign key (user_id, ingredient_id, batch_id) references public.batches(user_id, ingredient_id, id) on delete cascade
);
create index movements_batch_history on public.stock_movements(user_id, batch_id, created_at desc);

-- Retry receipts are separate from history so ingredient/settings changes are idempotent too.
create table public.inventory_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.ingredients enable row level security;
alter table public.batches enable row level security;
alter table public.stock_entries enable row level security;
alter table public.stock_movements enable row level security;
alter table public.inventory_requests enable row level security;

create policy "Read own ingredients" on public.ingredients for select to authenticated using (user_id = (select auth.uid()));
create policy "Read own batches" on public.batches for select to authenticated using (user_id = (select auth.uid()));
create policy "Read own entries" on public.stock_entries for select to authenticated using (user_id = (select auth.uid()));
create policy "Read own movements" on public.stock_movements for select to authenticated using (user_id = (select auth.uid()));
create policy "Read own requests" on public.inventory_requests for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.ingredients, public.batches, public.stock_entries, public.stock_movements, public.inventory_requests from public, anon, authenticated;
grant select on public.ingredients, public.batches, public.stock_entries, public.stock_movements, public.inventory_requests to authenticated;

create function public.inventory_read() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'ingredients', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit, 'threshold', i.minimum_quantity) order by i.created_at, i.id) from public.ingredients i where i.user_id = auth.uid()), '[]'::jsonb),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'ingredientId', b.ingredient_id, 'code', b.code, 'received', b.received_date, 'expiry', b.expiry_date, 'quantity', b.quantity) order by b.received_date, b.created_at, b.id) from public.batches b where b.user_id = auth.uid()), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'ingredientId', m.ingredient_id, 'batchId', m.batch_id, 'batch', b.code, 'quantity', m.quantity, 'type', e.kind, 'date', m.created_at, 'reason', coalesce(e.reason,'')) order by m.created_at desc, m.id) from public.stock_movements m join public.batches b on (b.user_id,b.id) = (m.user_id,m.batch_id) join public.stock_entries e on (e.user_id,e.id) = (m.user_id,m.entry_id) where m.user_id = auth.uid()), '[]'::jsonb)
  );
$$;

-- All app mutations enter here. A per-account transaction lock prevents stale
-- simultaneous allocations; retries of the same request cannot double-consume.
create function public.inventory_command(p_id text, p_kind text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  request public.inventory_requests%rowtype;
  item public.ingredients%rowtype;
  batch public.batches%rowtype;
  item_id text := p_data ->> 'ingredientId';
  batch_id text;
  q numeric;
  remaining numeric;
  take numeric;
  minimum numeric;
  operation_date date;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_id is null or length(p_id) not between 1 and 200 or p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid request.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into request from public.inventory_requests where user_id=actor and id=p_id;
  if found then
    if request.kind <> p_kind or request.payload <> p_data then raise exception 'Request ID was already used.'; end if;
    return public.inventory_read();
  end if;
  if p_kind = 'ingredient' then
    minimum := (p_data ->> 'threshold')::numeric;
    if minimum is null or minimum not between 0 and 1000000000000 or minimum <> round(minimum,3) then raise exception 'Invalid minimum.'; end if;
    insert into public.ingredients(user_id,id,name,unit,minimum_quantity)
    values(actor,p_id,trim(p_data->>'name'),trim(p_data->>'unit'),minimum);
  else
    select * into item from public.ingredients where user_id=actor and id=item_id for update;
    if not found then raise exception 'Ingredient not found.'; end if;
    if p_kind = 'settings' then
      minimum := (p_data ->> 'threshold')::numeric;
      if minimum is null or minimum not between 0 and 1000000000000 or minimum <> round(minimum,3) then raise exception 'Invalid minimum.'; end if;
      update public.ingredients set minimum_quantity=minimum where user_id=actor and id=item_id;
    elsif p_kind in ('receive','use','adjust') then
      q := (p_data ->> 'quantity')::numeric;
      if q is null or q not between 0 and 1000000000000 or q <> round(q,3) or (p_kind <> 'adjust' and q=0) then raise exception 'Invalid quantity.'; end if;
      operation_date := (p_data ->> 'today')::date;
      if operation_date is null or abs(operation_date - current_date) > 1 then raise exception 'Check your device date.'; end if;
      if p_kind = 'receive' then
        if (p_data->>'received')::date > operation_date then raise exception 'Received date cannot be in the future.'; end if;
        batch_id := p_id;
        insert into public.batches(user_id,id,ingredient_id,code,received_date,expiry_date)
        values(actor,batch_id,item_id,trim(p_data->>'code'),(p_data->>'received')::date,(p_data->>'expiry')::date);
        insert into public.stock_entries(user_id,id,ingredient_id,kind,quantity) values(actor,p_id,item_id,'received',q);
        insert into public.stock_movements(user_id,entry_id,ingredient_id,batch_id,quantity) values(actor,p_id,item_id,batch_id,q);
        update public.batches set quantity=q where user_id=actor and id=batch_id;
      elsif p_kind = 'adjust' then
        select * into batch from public.batches where user_id=actor and id=p_data->>'batchId' and ingredient_id=item_id for update;
        if not found then raise exception 'Batch not found.'; end if;
        q := q - batch.quantity;
        if q=0 then raise exception 'Quantity is unchanged.'; end if;
        if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Enter a reason.'; end if;
        insert into public.stock_entries(user_id,id,ingredient_id,kind,quantity,reason) values(actor,p_id,item_id,'adjusted',q,trim(p_data->>'reason'));
        insert into public.stock_movements(user_id,entry_id,ingredient_id,batch_id,quantity) values(actor,p_id,item_id,batch.id,q);
        update public.batches set quantity=quantity+q where user_id=actor and id=batch.id;
      else
        remaining := q;
        batch_id := nullif(p_data->>'batchId','');
        insert into public.stock_entries(user_id,id,ingredient_id,kind,quantity,selection_mode) values(actor,p_id,item_id,'used',-q,case when batch_id is null then 'auto' else 'manual' end);
        for batch in select * from public.batches b where b.user_id=actor and b.ingredient_id=item_id and b.expiry_date >= operation_date and (batch_id is null or b.id=batch_id) order by b.received_date,b.created_at,b.id for update
        loop
          take := least(remaining,greatest(0,batch.quantity-case when batch_id is null then item.minimum_quantity else 0 end));
          if take > 0 then
            insert into public.stock_movements(user_id,entry_id,ingredient_id,batch_id,quantity) values(actor,p_id,item_id,batch.id,-take);
            update public.batches set quantity=quantity-take where user_id=actor and id=batch.id;
            remaining := remaining-take;
          end if;
          exit when remaining=0;
        end loop;
        if remaining > 0 then raise exception 'Not enough available stock. Refresh and try again.'; end if;
      end if;
    else raise exception 'Unknown stock operation.';
    end if;
  end if;
  insert into public.inventory_requests(user_id,id,kind,payload) values(actor,p_id,p_kind,p_data);
  return public.inventory_read();
end;
$$;
revoke all on function public.inventory_read() from public, anon;
revoke all on function public.inventory_command(text,text,jsonb) from public, anon;
grant execute on function public.inventory_read(), public.inventory_command(text,text,jsonb) to authenticated;
