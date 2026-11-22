-- Isolated verification: no usable credentials, and ALL rows are rolled back.
begin;
insert into auth.users(id,aud,role) values ('aaaaaaaa-0000-4000-8000-000000000001','authenticated','authenticated'),('aaaaaaaa-0000-4000-8000-000000000002','authenticated','authenticated');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.shopping_state(user_id,data) values('aaaaaaaa-0000-4000-8000-000000000001','{"events":[],"next":1}');
do $$
declare r jsonb;
begin
 r:=public.apply_shopping_write(1,'bbbbbbbb-0000-4000-8000-000000000001','{"events":[{"id":"e","products":[{"id":"p","bought":1}],"orders":[{"id":"o","number":"unchanged","createdAt":"2026-01-01","rank":1,"name":"synthetic","lines":[{"id":"p","q":2}]}]}],"next":1}');
 if r->>'applied'<>'true' then raise exception 'Write failed'; end if;
 r:=public.apply_shopping_write(1,'bbbbbbbb-0000-4000-8000-000000000001','{"events":[],"next":1}');
 if r->>'applied'<>'true' or (select revision from public.shopping_state)<>2 then raise exception 'Retry was not idempotent'; end if;
 r:=public.apply_shopping_write(1,'bbbbbbbb-0000-4000-8000-000000000002','{"events":[],"next":1}');
 if r->>'applied'<>'false' then raise exception 'Stale revision overwrote data'; end if;
 begin
  update public.shopping_state set revision=revision+1,data=jsonb_set(data,'{events,0,orders,0,number}','"changed"');
  raise exception 'Immutable order number guard failed';
 exception when raise_exception then if sqlerrm='Immutable order number guard failed' then raise; end if; end;
 begin
  update public.shopping_state set revision=revision+1,data=jsonb_set(data,'{events,0,orders}','[]');
  raise exception 'Order deletion guard failed';
 exception when raise_exception then if sqlerrm='Order deletion guard failed' then raise; end if; end;
 begin
  update public.shopping_state set revision=revision+1,data=jsonb_set(data,'{events,0,orders,0,lines,0,q}','-1');
  raise exception 'Quantity guard failed';
 exception when raise_exception then if sqlerrm='Quantity guard failed' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.shopping_state) or exists(select 1 from public.shopping_writes) then raise exception 'RLS leaked another account'; end if;
 begin
  insert into public.shopping_state(user_id,data) values ('aaaaaaaa-0000-4000-8000-000000000001','{"events":[]}');
  raise exception 'RLS accepted another account owner';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: real database writes, idempotency, stale revision, order immutability, deletion guard, quantities and RLS isolation; all test rows rolled back' as verification;
