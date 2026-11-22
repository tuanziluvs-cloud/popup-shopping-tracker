create or replace function public.shopping_state_updated_at()
returns trigger language plpgsql set search_path = '' as $$
declare e jsonb; p jsonb; o jsonb; l jsonb; previous_order jsonb; old_event jsonb; new_event jsonb; seen text[]; product_ids text[];
begin
 if jsonb_typeof(new.data->'events') is distinct from 'array' then raise exception 'Invalid events'; end if;
 if tg_op='UPDATE' and new.revision<>old.revision+1 then raise exception 'Revision must increment exactly once'; end if;
 seen := array[]::text[];
 for e in select value from jsonb_array_elements(new.data->'events') loop
  if e->>'id' is null or e->>'id'=any(seen) or jsonb_typeof(e->'products') is distinct from 'array' or jsonb_typeof(e->'orders') is distinct from 'array' then raise exception 'Invalid event'; end if;
  seen:=array_append(seen,e->>'id'); product_ids:=array[]::text[];
  for p in select value from jsonb_array_elements(e->'products') loop
   if p->>'id' is null or p->>'id'=any(product_ids) or coalesce(p->>'bought','0') !~ '^\d+$' then raise exception 'Invalid product'; end if;
   product_ids:=array_append(product_ids,p->>'id');
  end loop;
  if (select count(*) from jsonb_array_elements(e->'orders')) <> (select count(distinct value->>'id') from jsonb_array_elements(e->'orders')) then raise exception 'Duplicate order ID'; end if;
  for o in select value from jsonb_array_elements(e->'orders') loop
   if o->>'id' is null or o->>'number' is null or coalesce(length(trim(o->>'name')),0)=0 or jsonb_typeof(o->'rank') is distinct from 'number' or jsonb_typeof(o->'lines') is distinct from 'array' or jsonb_array_length(o->'lines')=0 then raise exception 'Invalid order'; end if;
   for l in select value from jsonb_array_elements(o->'lines') loop
    if not (l->>'id'=any(product_ids)) or l->>'id' is null or coalesce(l->>'q','') !~ '^[1-9]\d*$' then raise exception 'Invalid line'; end if;
   end loop;
  end loop;
 end loop;
 if tg_op='UPDATE' then
  for old_event in select value from jsonb_array_elements(old.data->'events') loop
   select value into new_event from jsonb_array_elements(new.data->'events') where value->>'id'=old_event->>'id';
   if new_event is null then raise exception 'Events must be archived, not deleted'; end if;
   for previous_order in select value from jsonb_array_elements(old_event->'orders') loop
    select value into o from jsonb_array_elements(new_event->'orders') where value->>'id'=previous_order->>'id';
    if o is null or o->'number' is distinct from previous_order->'number' or o->'createdAt' is distinct from previous_order->'createdAt' then raise exception 'Order identity and creation time are immutable; deletion is disabled'; end if;
   end loop;
  end loop;
 end if;
 new.updated_at=now();return new;
end $$;
drop trigger if exists shopping_state_touch on public.shopping_state;
create trigger shopping_state_touch before insert or update on public.shopping_state for each row execute function public.shopping_state_updated_at();
revoke all on public.shopping_state from anon;
grant select,insert,update on public.shopping_state to authenticated;
revoke delete on public.shopping_state from authenticated;
