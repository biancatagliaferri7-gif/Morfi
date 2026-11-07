-- Incremental MORFI platform features.
-- Review and apply manually in a development Supabase project before production.

begin;

alter table public.morfi_businesses
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists bank_name text,
  add column if not exists bank_cuit text;

grant select (latitude, longitude)
on public.morfi_businesses to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_coordinates_valid'
  ) then
    alter table public.morfi_businesses
      add constraint morfi_businesses_coordinates_valid
      check (
        (latitude is null) = (longitude is null)
        and (
          latitude is null
          or (
          latitude between -90 and 90
          and longitude between -180 and 180
          )
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_bank_cuit_valid'
  ) then
    alter table public.morfi_businesses
      add constraint morfi_businesses_bank_cuit_valid
      check (bank_cuit is null or bank_cuit ~ '^[0-9]{11}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_bank_name_length'
  ) then
    alter table public.morfi_businesses
      add constraint morfi_businesses_bank_name_length
      check (bank_name is null or length(bank_name) <= 120);
  end if;
end
$$;

alter table public.morfi_orders
  add column if not exists status_reason text;

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
select order_record.id, order_record.status, null,
  nullif(btrim(order_record.status_reason), ''), order_record.created_at
from public.morfi_orders order_record
where not exists (
  select 1
  from public.morfi_order_status_history history
  where history.order_id = order_record.id
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
    )
    values (
      new.id, new.status, auth.uid(), nullif(btrim(new.status_reason), '')
    );
  end if;
  return new;
end
$$;

drop trigger if exists morfi_orders_record_status_history on public.morfi_orders;
create trigger morfi_orders_record_status_history
after insert or update of status on public.morfi_orders
for each row execute function public.morfi_record_order_status_history();

create or replace function public.morfi_update_order_status_with_reason(
  p_order_id uuid,
  p_new_status public.morfi_order_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_new_status is null then
    raise exception 'A new order status is required';
  end if;
  if p_reason is not null and length(btrim(p_reason)) > 500 then
    raise exception 'The order status reason is too long';
  end if;
  if p_new_status = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'A rejection reason is required';
  end if;

  update public.morfi_orders
  set status_reason = case
    when p_new_status in ('rejected', 'cancelled', 'cancellation_requested')
      then nullif(btrim(p_reason), '')
    else null
  end
  where id = p_order_id;

  perform public.morfi_update_order_status(p_order_id, p_new_status);
end
$$;

create table if not exists public.morfi_business_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.morfi_orders(id) on delete cascade,
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  customer_id uuid not null references public.morfi_profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.morfi_product_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  product_id uuid not null,
  customer_id uuid not null references public.morfi_profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (order_id, product_id),
  foreign key (order_id, business_id)
    references public.morfi_orders(id, business_id) on delete cascade,
  foreign key (product_id, business_id)
    references public.morfi_business_products(id, business_id) on delete cascade
);

create index if not exists morfi_business_reviews_summary
  on public.morfi_business_reviews (business_id, created_at desc);
create index if not exists morfi_product_reviews_summary
  on public.morfi_product_reviews (product_id, created_at desc);

create or replace function public.morfi_validate_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.morfi_orders%rowtype;
begin
  select *
  into v_order
  from public.morfi_orders
  where id = new.order_id
  for share;

  if not found or v_order.status <> 'delivered' then
    raise exception 'Only delivered orders can be reviewed';
  end if;
  if auth.uid() is null or v_order.customer_id <> auth.uid() then
    raise exception 'Only the customer who placed the order can review it';
  end if;

  new.business_id := v_order.business_id;
  new.customer_id := v_order.customer_id;

  if tg_table_name = 'morfi_product_reviews'
    and not exists (
      select 1
      from public.morfi_order_items item
      where item.order_id = new.order_id
        and item.business_id = v_order.business_id
        and item.product_id = new.product_id
    )
  then
    raise exception 'Only products included in the delivered order can be reviewed';
  end if;

  return new;
end
$$;

drop trigger if exists morfi_business_reviews_validate on public.morfi_business_reviews;
create trigger morfi_business_reviews_validate
before insert on public.morfi_business_reviews
for each row execute function public.morfi_validate_review();

drop trigger if exists morfi_product_reviews_validate on public.morfi_product_reviews;
create trigger morfi_product_reviews_validate
before insert on public.morfi_product_reviews
for each row execute function public.morfi_validate_review();

alter table public.morfi_order_status_history enable row level security;
alter table public.morfi_business_reviews enable row level security;
alter table public.morfi_product_reviews enable row level security;

revoke all on public.morfi_order_status_history,
  public.morfi_business_reviews,
  public.morfi_product_reviews
from public, anon, authenticated;

grant select on public.morfi_order_status_history to authenticated;
grant insert on public.morfi_business_reviews,
  public.morfi_product_reviews
to authenticated;
grant select on public.morfi_business_reviews,
  public.morfi_product_reviews
to authenticated, anon;

drop policy if exists morfi_order_status_history_participants on public.morfi_order_status_history;
create policy morfi_order_status_history_participants
on public.morfi_order_status_history for select to authenticated
using (
  exists (
    select 1
    from public.morfi_orders order_record
    where order_record.id = order_id
      and (
        order_record.customer_id = (select auth.uid())
        or public.morfi_has_business_access(order_record.business_id)
      )
  )
);

drop policy if exists morfi_business_reviews_public_read on public.morfi_business_reviews;
create policy morfi_business_reviews_public_read
on public.morfi_business_reviews for select to anon, authenticated
using (true);

drop policy if exists morfi_business_reviews_customer_insert on public.morfi_business_reviews;
create policy morfi_business_reviews_customer_insert
on public.morfi_business_reviews for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and exists (
    select 1 from public.morfi_orders order_record
    where order_record.id = order_id
      and order_record.customer_id = (select auth.uid())
      and order_record.status = 'delivered'
  )
);

drop policy if exists morfi_product_reviews_public_read on public.morfi_product_reviews;
create policy morfi_product_reviews_public_read
on public.morfi_product_reviews for select to anon, authenticated
using (true);

drop policy if exists morfi_product_reviews_customer_insert on public.morfi_product_reviews;
create policy morfi_product_reviews_customer_insert
on public.morfi_product_reviews for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and exists (
    select 1 from public.morfi_order_items item
    join public.morfi_orders order_record on order_record.id = item.order_id
    where item.order_id = morfi_product_reviews.order_id
      and item.business_id = morfi_product_reviews.business_id
      and item.product_id = morfi_product_reviews.product_id
      and order_record.customer_id = (select auth.uid())
      and order_record.status = 'delivered'
  )
);

create or replace view public.morfi_business_review_summary
with (security_invoker = true, security_barrier = true)
as
select business_id, count(*)::integer as review_count,
  round(avg(rating)::numeric, 2) as average_rating
from public.morfi_business_reviews
group by business_id;

create or replace view public.morfi_product_review_summary
with (security_invoker = true, security_barrier = true)
as
select product_id, count(*)::integer as review_count,
  round(avg(rating)::numeric, 2) as average_rating
from public.morfi_product_reviews
group by product_id;

grant select on public.morfi_business_review_summary,
  public.morfi_product_review_summary
to anon, authenticated;

revoke all on function public.morfi_update_order_status_with_reason(
  uuid, public.morfi_order_status, text
) from public, anon;
grant execute on function public.morfi_update_order_status_with_reason(
  uuid, public.morfi_order_status, text
) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'morfi_orders'
  ) then
    alter publication supabase_realtime add table public.morfi_orders;
  end if;
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'morfi_order_status_history'
  ) then
    alter publication supabase_realtime add table public.morfi_order_status_history;
  end if;
end
$$;

commit;
