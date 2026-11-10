-- Repair the missing status history used by customer and business order lists.
-- Existing orders receive only their current status; earlier transitions are unknown.
begin;

create table if not exists public.morfi_order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.morfi_orders(id) on delete cascade,
  status public.morfi_order_status not null,
  changed_by uuid references public.morfi_profiles(id) on delete set null,
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists morfi_order_status_history_order_date
  on public.morfi_order_status_history (order_id, created_at, id);

insert into public.morfi_order_status_history (
  order_id, status, changed_by, reason, created_at
)
select orders.id, orders.status, null,
  nullif(btrim(orders.status_reason), ''), now()
from public.morfi_orders orders
where not exists (
  select 1 from public.morfi_order_status_history history
  where history.order_id = orders.id
);

create or replace function public.morfi_record_order_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.morfi_order_status_history (
      order_id, status, changed_by, reason
    ) values (
      new.id, new.status, auth.uid(), nullif(btrim(new.status_reason), '')
    );
  end if;
  return new;
end
$$;

revoke all on function public.morfi_record_order_status_history()
  from public, anon, authenticated;

drop trigger if exists morfi_orders_record_status_history on public.morfi_orders;
create trigger morfi_orders_record_status_history
after insert or update of status on public.morfi_orders
for each row execute function public.morfi_record_order_status_history();

alter table public.morfi_order_status_history enable row level security;
revoke all on public.morfi_order_status_history from public, anon, authenticated;
grant select on public.morfi_order_status_history to authenticated;

drop policy if exists morfi_order_status_history_participants
  on public.morfi_order_status_history;
create policy morfi_order_status_history_participants
on public.morfi_order_status_history for select to authenticated
using (
  exists (
    select 1 from public.morfi_orders orders
    where orders.id = order_id
      and (
        orders.customer_id = (select auth.uid())
        or public.morfi_has_business_access(orders.business_id)
      )
  )
);

commit;
notify pgrst, 'reload schema';
