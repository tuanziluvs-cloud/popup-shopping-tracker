create table public.shopping_writes (
 user_id uuid not null references auth.users(id) on delete cascade,
 mutation_id uuid not null,
 revision bigint not null,
 created_at timestamptz not null default now(),
 primary key(user_id,mutation_id)
);
alter table public.shopping_writes enable row level security;
create policy writes_read_own on public.shopping_writes for select to authenticated using ((select auth.uid())=user_id);
create policy writes_insert_own on public.shopping_writes for insert to authenticated with check ((select auth.uid())=user_id);
grant select,insert on public.shopping_writes to authenticated;
revoke all on public.shopping_writes from anon;
create function public.apply_shopping_write(expected_revision bigint, mutation_id uuid, candidate jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare state public.shopping_state%rowtype; applied_revision bigint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into state from public.shopping_state where user_id=auth.uid() for update;
 if not found then raise exception 'Initialize account before writing'; end if;
 select w.revision into applied_revision from public.shopping_writes w where w.user_id=auth.uid() and w.mutation_id=apply_shopping_write.mutation_id;
 if found then return jsonb_build_object('applied',true,'revision',applied_revision); end if;
 if state.revision<>expected_revision then return jsonb_build_object('applied',false); end if;
 update public.shopping_state set data=candidate,revision=state.revision+1 where user_id=auth.uid();
 insert into public.shopping_writes(user_id,mutation_id,revision) values(auth.uid(),apply_shopping_write.mutation_id,state.revision+1);
 return jsonb_build_object('applied',true,'revision',state.revision+1);
end $$;
revoke all on function public.apply_shopping_write(bigint,uuid,jsonb) from public,anon;
grant execute on function public.apply_shopping_write(bigint,uuid,jsonb) to authenticated;
