create or replace function public.check_shopping_order_limits()
returns trigger language plpgsql set search_path = '' as $$
declare e jsonb; p jsonb; used numeric;
begin
 for e in select value from jsonb_array_elements(new.data->'events') loop
  for p in select value from jsonb_array_elements(e->'products') loop
   if p ? 'orderLimit' and p->'orderLimit' <> 'null'::jsonb then
    if jsonb_typeof(p->'orderLimit') <> 'number' or (p->>'orderLimit')::numeric < 0 or trunc((p->>'orderLimit')::numeric) <> (p->>'orderLimit')::numeric then raise exception 'Invalid order limit'; end if;
    select coalesce(sum((l.value->>'q')::numeric),0) into used
    from jsonb_array_elements(e->'orders') o
    cross join lateral jsonb_array_elements(o.value->'lines') l
    where l.value->>'id'=p->>'id';
    if used > (p->>'orderLimit')::numeric then raise exception 'Order limit exceeded: %',p->>'id'; end if;
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.check_shopping_order_limits() from public, anon, authenticated;
drop trigger if exists shopping_order_limits on public.shopping_state;
create trigger shopping_order_limits before insert or update on public.shopping_state for each row execute function public.check_shopping_order_limits();
