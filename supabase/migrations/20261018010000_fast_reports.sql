-- Version every change that can affect a report, including backdated offline entries.
create table public.inventory_report_versions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0
);
alter table public.inventory_report_versions enable row level security;
create policy "Read own report version" on public.inventory_report_versions
  for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.inventory_report_versions from public,anon,authenticated;
grant select on public.inventory_report_versions to authenticated;

create function public.inventory_bump_report_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner uuid := case when TG_OP='DELETE' then OLD.user_id else NEW.user_id end;
begin
  if exists(select 1 from auth.users where id=owner) then
    insert into public.inventory_report_versions(user_id,revision) values(owner,1)
      on conflict(user_id) do update set revision=public.inventory_report_versions.revision+1;
  end if;
  return null;
end $$;
revoke all on function public.inventory_bump_report_version() from public,anon,authenticated;
create trigger ingredients_report_version after insert or update or delete on public.ingredients
  for each row execute function public.inventory_bump_report_version();
create trigger batches_report_version after insert or update or delete on public.batches
  for each row execute function public.inventory_bump_report_version();
create trigger entries_report_version after insert or update or delete on public.stock_entries
  for each row execute function public.inventory_bump_report_version();
create trigger movements_report_version after insert or update or delete on public.stock_movements
  for each row execute function public.inventory_bump_report_version();

-- One snapshot per page; clients reject pages from different revisions.
create function public.inventory_report_page(
  p_offset integer default 0, p_limit integer default 1000,
  p_ingredients text[] default null, p_from timestamptz default null,
  p_to timestamptz default null, p_known_revision text default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  version text;
  page_size integer := least(greatest(p_limit,1),1000);
  page_offset integer := greatest(p_offset,0);
begin
  if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if p_from>=p_to then raise exception 'Invalid report dates.'; end if;
  select coalesce((select revision from public.inventory_report_versions where user_id=actor),0)::text into version;
  if p_known_revision=version then return jsonb_build_object('revision',version,'unchanged',true); end if;
  return jsonb_build_object(
    'revision',version,'unchanged',false,
    'ingredients',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id,name,unit,minimum_quantity as threshold from public.ingredients
      where user_id=actor and (p_ingredients is null or id=any(p_ingredients))
      order by id limit page_size offset page_offset
    ) x),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id,ingredient_id as "ingredientId",code,received_date as received,expiry_date as expiry,quantity
      from public.batches where user_id=actor and (p_ingredients is null or ingredient_id=any(p_ingredients))
      order by id limit page_size offset page_offset
    ) x),'[]'::jsonb),
    'movements',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select m.id,m.ingredient_id as "ingredientId",m.batch_id as "batchId",b.code as batch,
        m.quantity,e.kind as type,m.created_at as date,coalesce(e.reason,'') as reason
      from public.stock_movements m
      join public.batches b on (b.user_id,b.id)=(m.user_id,m.batch_id)
      join public.stock_entries e on (e.user_id,e.id)=(m.user_id,m.entry_id)
      where m.user_id=actor and (p_ingredients is null or m.ingredient_id=any(p_ingredients))
        and (p_from is null or m.created_at>=p_from) and (p_to is null or m.created_at<p_to)
      order by m.created_at desc,m.id desc limit page_size offset page_offset
    ) x),'[]'::jsonb),
    'total',case when page_offset=0 then greatest(
      (select count(*) from public.ingredients where user_id=actor and (p_ingredients is null or id=any(p_ingredients))),
      (select count(*) from public.batches where user_id=actor and (p_ingredients is null or ingredient_id=any(p_ingredients))),
      (select count(*) from public.stock_movements where user_id=actor and (p_ingredients is null or ingredient_id=any(p_ingredients))
        and (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to))
    ) else null end
  );
end $$;
revoke all on function public.inventory_report_page(integer,integer,text[],timestamptz,timestamptz,text) from public,anon;
grant execute on function public.inventory_report_page(integer,integer,text[],timestamptz,timestamptz,text) to authenticated;
