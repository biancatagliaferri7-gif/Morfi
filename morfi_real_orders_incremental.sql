-- MORFI real orders incremental migration.
-- Do not apply until reviewed and explicitly approved.
-- This migration adds supplier orders and safe customer/payment snapshots to meal orders.

begin;

alter table public.morfi_suppliers
  add column if not exists accepts_pickup boolean not null default false,
  add column if not exists accepts_delivery boolean not null default false,
  add column if not exists delivery_fee numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_suppliers'::regclass
      and conname = 'morfi_suppliers_delivery_fee_nonnegative'
  ) then
    alter table public.morfi_suppliers
      add constraint morfi_suppliers_delivery_fee_nonnegative
      check (delivery_fee >= 0);
  end if;
end
$$;

alter table public.morfi_orders
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists payment_status text not null default 'not_applicable';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_payment_status_valid'
  ) then
    alter table public.morfi_orders
      add constraint morfi_orders_payment_status_valid
      check (payment_status in (
        'not_applicable',
        'awaiting_collection',
        'pending_verification',
        'verified',
        'rejected'
      ));
  end if;
end
$$;

create or replace function public.morfi_snapshot_order_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select profile.full_name, profile.phone
  into new.customer_name_snapshot, new.customer_phone_snapshot
  from public.morfi_profiles profile
  where profile.id = new.customer_id;

  if not found then
    raise exception 'Customer profile is unavailable';
  end if;

  new.payment_status := case new.payment_method
    when 'transfer' then 'pending_verification'
    when 'cash' then 'awaiting_collection'
    else 'not_applicable'
  end;
  return new;
end
$$;

drop trigger if exists morfi_orders_customer_snapshot on public.morfi_orders;
create trigger morfi_orders_customer_snapshot
before insert on public.morfi_orders
for each row execute function public.morfi_snapshot_order_customer();

create table if not exists public.morfi_supplier_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.morfi_profiles(id) on delete restrict,
  supplier_id uuid not null references public.morfi_suppliers(id) on delete restrict,
  request_key uuid not null,
  request_fingerprint text not null,
  status public.morfi_order_status not null default 'pending',
  payment_status text not null,
  delivery_mode text not null check (delivery_mode in ('pickup', 'delivery')),
  delivery_address text,
  payment_method text not null check (payment_method in ('cash', 'transfer')),
  customer_name_snapshot text not null,
  customer_phone_snapshot text,
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, supplier_id),
  unique (customer_id, request_key),
  check (payment_status in (
    'awaiting_collection',
    'pending_verification',
    'verified',
    'rejected'
  )),
  check (
    (delivery_mode = 'delivery' and nullif(btrim(delivery_address), '') is not null)
    or (delivery_mode = 'pickup' and delivery_address is null)
  )
);

create table if not exists public.morfi_supplier_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  supplier_id uuid not null,
  product_id uuid not null,
  promotion_id uuid,
  product_name text not null,
  promotion_title text,
  quantity integer not null check (quantity > 0),
  base_unit_price numeric(12, 2) not null check (base_unit_price > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  cash_discount_percent numeric(5, 2)
    check (cash_discount_percent is null or cash_discount_percent between 0 and 100),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (order_id, product_id),
  foreign key (order_id, supplier_id)
    references public.morfi_supplier_orders(id, supplier_id) on delete cascade,
  foreign key (product_id, supplier_id)
    references public.morfi_supplier_products(id, supplier_id) on delete restrict,
  foreign key (promotion_id)
    references public.morfi_supplier_promotions(id) on delete set null
);

create or replace function public.morfi_block_rejected_transfer_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.payment_status = 'rejected' or new.payment_status = 'rejected')
    and new.status not in (
      'rejected'::public.morfi_order_status,
      'cancelled'::public.morfi_order_status,
      'cancellation_requested'::public.morfi_order_status
    )
  then
    raise exception 'An order with a rejected transfer cannot advance without an explicit resolution';
  end if;

  return new;
end
$$;

drop trigger if exists morfi_orders_block_rejected_transfer_progress on public.morfi_orders;
create trigger morfi_orders_block_rejected_transfer_progress
before update of status on public.morfi_orders
for each row execute function public.morfi_block_rejected_transfer_progress();

drop trigger if exists morfi_supplier_orders_block_rejected_transfer_progress on public.morfi_supplier_orders;
create trigger morfi_supplier_orders_block_rejected_transfer_progress
before update of status on public.morfi_supplier_orders
for each row execute function public.morfi_block_rejected_transfer_progress();

create index if not exists morfi_supplier_orders_customer_date
  on public.morfi_supplier_orders (customer_id, created_at desc);
create index if not exists morfi_supplier_orders_supplier_date
  on public.morfi_supplier_orders (supplier_id, created_at desc);
create index if not exists morfi_supplier_order_items_order
  on public.morfi_supplier_order_items (supplier_id, order_id);

alter table public.morfi_supplier_orders enable row level security;
alter table public.morfi_supplier_order_items enable row level security;

revoke all on public.morfi_supplier_orders, public.morfi_supplier_order_items
  from public, anon, authenticated;
grant select on public.morfi_supplier_orders, public.morfi_supplier_order_items
  to authenticated;

drop policy if exists supplier_orders_select_participant on public.morfi_supplier_orders;
create policy supplier_orders_select_participant
on public.morfi_supplier_orders for select to authenticated
using (
  customer_id = (select auth.uid())
  or public.morfi_has_supplier_access(
    supplier_id,
    array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
  )
);

drop policy if exists supplier_order_items_select_participant on public.morfi_supplier_order_items;
create policy supplier_order_items_select_participant
on public.morfi_supplier_order_items for select to authenticated
using (
  exists (
    select 1
    from public.morfi_supplier_orders order_record
    where order_record.id = morfi_supplier_order_items.order_id
      and order_record.supplier_id = morfi_supplier_order_items.supplier_id
      and (
        order_record.customer_id = (select auth.uid())
        or public.morfi_has_supplier_access(
          order_record.supplier_id,
          array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
        )
      )
  )
);

create or replace function public.morfi_create_supplier_order(
  p_supplier_id uuid,
  p_items jsonb,
  p_delivery_mode text,
  p_delivery_address text,
  p_payment_method text,
  p_request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.morfi_suppliers%rowtype;
  v_product public.morfi_supplier_products%rowtype;
  v_customer public.morfi_profiles%rowtype;
  v_item record;
  v_order_id uuid := gen_random_uuid();
  v_subtotal numeric(12, 2) := 0;
  v_discount numeric(12, 2) := 0;
  v_line_total numeric(12, 2);
  v_unit_price numeric(12, 2);
  v_cash_discount numeric(5, 2);
  v_promotion_id uuid;
  v_promotion_title text;
  v_promotion record;
  v_promotion_price numeric(12, 2);
  v_count integer := 0;
  v_request_fingerprint text;
  v_existing_fingerprint text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_supplier_id is null or p_request_key is null then
    raise exception 'Supplier and idempotency key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Products must be provided as a JSON array';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'Provide between 1 and 100 products';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as entries(entry)
    where jsonb_typeof(entry) <> 'object'
      or coalesce(entry ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or case
        when coalesce(entry ->> 'quantity', '') ~ '^[1-9][0-9]{0,4}$'
          then (entry ->> 'quantity')::integer > 10000
        else true
      end
  ) then
    raise exception 'Each product needs a valid id and a quantity from 1 to 10000';
  end if;
  if p_delivery_mode is null or p_delivery_mode not in ('pickup', 'delivery') then
    raise exception 'Unsupported delivery mode';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'transfer') then
    raise exception 'Unsupported payment method';
  end if;

  v_request_fingerprint := md5(concat_ws(
    '|', p_supplier_id::text, p_items::text, p_delivery_mode,
    coalesce(p_delivery_address, ''), p_payment_method
  ));
  select id, request_fingerprint
  into v_order_id, v_existing_fingerprint
  from public.morfi_supplier_orders
  where customer_id = auth.uid() and request_key = p_request_key;
  if found then
    if v_existing_fingerprint <> v_request_fingerprint then
      raise exception 'This request key was already used for a different order';
    end if;
    return v_order_id;
  end if;
  v_order_id := gen_random_uuid();

  select *
  into v_supplier
  from public.morfi_suppliers
  where id = p_supplier_id and is_published and show_in_market
  for update;
  if not found then
    raise exception 'Supplier is unavailable in Mercado';
  end if;
  if p_delivery_mode = 'delivery' then
    if not v_supplier.accepts_delivery then
      raise exception 'Delivery is unavailable for this supplier';
    end if;
    if nullif(btrim(p_delivery_address), '') is null then
      raise exception 'Delivery address is required';
    end if;
  elsif not v_supplier.accepts_pickup then
    raise exception 'Pickup is unavailable for this supplier';
  end if;

  select *
  into v_customer
  from public.morfi_profiles
  where id = auth.uid();
  if not found then
    raise exception 'Customer profile is unavailable';
  end if;

  insert into public.morfi_supplier_orders (
    id, customer_id, supplier_id, request_key, request_fingerprint,
    status, payment_status, delivery_mode, delivery_address, payment_method,
    customer_name_snapshot, customer_phone_snapshot, delivery_fee
  )
  values (
    v_order_id, auth.uid(), v_supplier.id, p_request_key, v_request_fingerprint,
    'pending',
    case when p_payment_method = 'transfer' then 'pending_verification' else 'awaiting_collection' end,
    p_delivery_mode,
    case when p_delivery_mode = 'delivery' then btrim(p_delivery_address) else null end,
    p_payment_method,
    coalesce(v_customer.full_name, ''),
    v_customer.phone,
    case when p_delivery_mode = 'delivery' then v_supplier.delivery_fee else 0 end
  )
  on conflict (customer_id, request_key) do nothing;
  if not found then
    select id, request_fingerprint
    into v_order_id, v_existing_fingerprint
    from public.morfi_supplier_orders
    where customer_id = auth.uid() and request_key = p_request_key;
    if v_existing_fingerprint <> v_request_fingerprint then
      raise exception 'This request key was already used for a different order';
    end if;
    return v_order_id;
  end if;

  for v_item in
    select (entry ->> 'product_id')::uuid as product_id,
           sum((entry ->> 'quantity')::integer)::numeric as quantity
    from jsonb_array_elements(p_items) as entries(entry)
    group by (entry ->> 'product_id')::uuid
    order by (entry ->> 'product_id')::uuid
  loop
    if v_item.quantity > 10000 then
      raise exception 'Combined quantity for a product cannot exceed 10000';
    end if;

    select *
    into v_product
    from public.morfi_supplier_products
    where id = v_item.product_id
      and supplier_id = v_supplier.id
      and is_available
    for update;
    if not found then
      raise exception 'A product is unavailable or does not belong to this supplier';
    end if;
    if p_delivery_mode = 'delivery' and not v_product.accepts_delivery then
      raise exception 'A product in this order is not available for delivery';
    end if;
    if not (p_payment_method = any(v_product.payment_methods)) then
      raise exception 'A product in this order does not accept the selected payment method';
    end if;

    v_unit_price := v_product.price;
    v_promotion_id := null;
    v_promotion_title := null;
    for v_promotion in
      select promotion.id,
             promotion.title,
             promotion.discount_type,
             promotion.discount_value
      from public.morfi_supplier_promotions promotion
      where promotion.supplier_id = v_supplier.id
        and (promotion.supplier_product_id is null or promotion.supplier_product_id = v_product.id)
        and promotion.is_active
        and promotion.starts_at <= now()
        and promotion.ends_at > now()
      order by promotion.id
      for share
    loop
      v_promotion_price := case
        when v_promotion.discount_type = 'percent'
          then round(v_product.price * (1 - v_promotion.discount_value / 100), 2)
        else v_promotion.discount_value
      end;

      if v_promotion_price > 0
        and v_promotion_price < v_unit_price
      then
        v_unit_price := v_promotion_price;
        v_promotion_id := v_promotion.id;
        v_promotion_title := v_promotion.title;
      elsif v_promotion_price = v_unit_price
        and v_promotion_id is not null
        and v_promotion.id < v_promotion_id
      then
        v_promotion_id := v_promotion.id;
        v_promotion_title := v_promotion.title;
      end if;
    end loop;

    v_cash_discount := case
      when p_payment_method = 'cash' then coalesce(v_product.cash_discount_percent, 0)
      else 0
    end;
    v_line_total := round(
      v_unit_price * v_item.quantity::integer * (1 - v_cash_discount / 100),
      2
    );
    v_subtotal := v_subtotal + v_product.price * v_item.quantity::integer;
    v_discount := v_discount + (v_product.price * v_item.quantity::integer - v_line_total);

    insert into public.morfi_supplier_order_items (
      order_id, supplier_id, product_id, promotion_id, product_name, promotion_title,
      quantity, base_unit_price, unit_price, cash_discount_percent, line_total
    )
    values (
      v_order_id, v_supplier.id, v_product.id, v_promotion_id, v_product.name, v_promotion_title,
      v_item.quantity::integer, v_product.price, v_unit_price,
      case when p_payment_method = 'cash' then v_product.cash_discount_percent else null end,
      v_line_total
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'At least one valid product is required';
  end if;

  update public.morfi_supplier_orders
  set subtotal = round(v_subtotal, 2),
      discount_total = round(v_discount, 2),
      total = round(v_subtotal - v_discount + delivery_fee, 2),
      updated_at = now()
  where id = v_order_id;

  return v_order_id;
end
$$;

create or replace function public.morfi_update_supplier_order_status(
  p_order_id uuid,
  p_new_status public.morfi_order_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.morfi_supplier_orders%rowtype;
  v_is_supplier_member boolean;
  v_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_new_status is null then
    raise exception 'A new order status is required';
  end if;

  select *
  into v_order
  from public.morfi_supplier_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found';
  end if;

  v_is_supplier_member := public.morfi_has_supplier_access(
    v_order.supplier_id,
    array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
  );

  if auth.uid() = v_order.customer_id then
    v_allowed :=
      (v_order.status = 'pending' and p_new_status = 'cancelled')
      or (
        v_order.status in ('accepted', 'preparing', 'ready')
        and p_new_status = 'cancellation_requested'
      );
  end if;

  if v_is_supplier_member then
    v_allowed := v_allowed or (
      (v_order.status = 'pending' and p_new_status in ('accepted', 'rejected'))
      or (v_order.status = 'accepted' and p_new_status = 'preparing')
      or (v_order.status = 'preparing' and p_new_status = 'ready')
      or (
        v_order.status = 'ready'
        and p_new_status = case
          when v_order.delivery_mode = 'delivery' then 'on_the_way'::public.morfi_order_status
          else 'delivered'::public.morfi_order_status
        end
      )
      or (v_order.status = 'on_the_way' and p_new_status = 'delivered')
      or (v_order.status = 'cancellation_requested' and p_new_status = 'cancelled')
    );
  end if;

  if not v_allowed then
    raise exception 'This order status transition is not allowed';
  end if;

  update public.morfi_supplier_orders
  set status = p_new_status,
      updated_at = now()
  where id = v_order.id;
end
$$;

create or replace function public.morfi_review_transfer_payment(
  p_order_id uuid,
  p_order_type text,
  p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_order_status public.morfi_order_status;
  v_resolution_status public.morfi_order_status;
  v_payment_method text;
  v_payment_status text;
  v_item record;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_order_id is null or p_approved is null then
    raise exception 'Order and review decision are required';
  end if;

  if p_order_type = 'business' then
    select business_id, status, payment_method, payment_status
    into v_workspace_id, v_order_status, v_payment_method, v_payment_status
    from public.morfi_orders
    where id = p_order_id
    for update;
    if not found then
      raise exception 'Order not found';
    end if;
    if not public.morfi_has_business_access(
      v_workspace_id,
      array['owner', 'manager']::public.morfi_workspace_role[]
    ) then
      raise exception 'Only this business owner or manager can review transfer payments';
    end if;
  elsif p_order_type = 'supplier' then
    select supplier_id, status, payment_method, payment_status
    into v_workspace_id, v_order_status, v_payment_method, v_payment_status
    from public.morfi_supplier_orders
    where id = p_order_id
    for update;
    if not found then
      raise exception 'Order not found';
    end if;
    if not public.morfi_has_supplier_access(
      v_workspace_id,
      array['owner', 'manager']::public.morfi_workspace_role[]
    ) then
      raise exception 'Only this supplier owner or manager can review transfer payments';
    end if;
  else
    raise exception 'Unsupported order type';
  end if;

  if v_payment_method <> 'transfer' or v_payment_status <> 'pending_verification' then
    raise exception 'This order has no transfer payment pending verification';
  end if;
  if v_order_status in ('rejected', 'cancelled') then
    raise exception 'A rejected or cancelled order cannot have its transfer reviewed';
  end if;
  if not p_approved and v_order_status in ('on_the_way', 'delivered') then
    raise exception 'A transfer cannot be rejected after delivery has started';
  end if;
  if not p_approved then
    if v_order_status not in (
      'pending',
      'accepted',
      'preparing',
      'ready',
      'cancellation_requested'
    ) then
      raise exception 'This order status cannot be resolved by rejecting its transfer';
    end if;
    v_resolution_status := case
      when v_order_status = 'cancellation_requested'
        then 'cancelled'::public.morfi_order_status
      else 'rejected'::public.morfi_order_status
    end;
  end if;

  if p_order_type = 'business' then
    if not p_approved then
      for v_item in
        select product_id, recipe_id
        from public.morfi_order_items
        where order_id = p_order_id and business_id = v_workspace_id
        order by product_id
      loop
        perform 1
        from public.morfi_business_products
        where id = v_item.product_id and business_id = v_workspace_id
        for update;
        if not found then
          raise exception 'Product inventory for this order is unavailable';
        end if;

        if v_item.recipe_id is not null then
          perform 1
          from public.morfi_recipes
          where id = v_item.recipe_id and business_id = v_workspace_id
          for update;
          if not found then
            raise exception 'Recipe inventory for this order is unavailable';
          end if;
        end if;
      end loop;

      update public.morfi_recipes recipe
      set finished_stock = recipe.finished_stock + item_totals.quantity,
          updated_at = now()
      from (
        select recipe_id, sum(quantity)::numeric(14, 4) as quantity
        from public.morfi_order_items
        where order_id = p_order_id
          and business_id = v_workspace_id
          and recipe_id is not null
        group by recipe_id
      ) as item_totals
      where recipe.id = item_totals.recipe_id
        and recipe.business_id = v_workspace_id;

      update public.morfi_business_products product
      set stock_quantity = product.stock_quantity + item_totals.quantity,
          updated_at = now()
      from (
        select product_id, sum(quantity)::integer as quantity
        from public.morfi_order_items
        where order_id = p_order_id
          and business_id = v_workspace_id
          and recipe_id is null
        group by product_id
      ) as item_totals
      where product.id = item_totals.product_id
        and product.business_id = v_workspace_id;

      insert into public.morfi_inventory_movements (
        business_id, recipe_id, order_id, movement_type,
        quantity_delta, unit, reason, created_by
      )
      select
        v_workspace_id,
        item_totals.recipe_id,
        p_order_id,
        'order_return',
        item_totals.quantity,
        recipe.yield_unit::text,
        'Devolución por transferencia rechazada ' || left(p_order_id::text, 8),
        auth.uid()
      from (
        select recipe_id, sum(quantity)::numeric(14, 4) as quantity
        from public.morfi_order_items
        where order_id = p_order_id
          and business_id = v_workspace_id
          and recipe_id is not null
        group by recipe_id
      ) as item_totals
      join public.morfi_recipes recipe
        on recipe.id = item_totals.recipe_id
        and recipe.business_id = v_workspace_id;

      insert into public.morfi_inventory_movements (
        business_id, product_id, order_id, movement_type,
        quantity_delta, unit, reason, created_by
      )
      select
        v_workspace_id,
        item_totals.product_id,
        p_order_id,
        'order_return',
        item_totals.quantity,
        'unidad',
        'Devolución por transferencia rechazada ' || left(p_order_id::text, 8),
        auth.uid()
      from (
        select product_id, sum(quantity)::numeric(14, 4) as quantity
        from public.morfi_order_items
        where order_id = p_order_id
          and business_id = v_workspace_id
          and recipe_id is null
        group by product_id
      ) as item_totals;
    end if;

    update public.morfi_orders
    set payment_status = case when p_approved then 'verified' else 'rejected' end,
        status = case when p_approved then status else v_resolution_status end,
        updated_at = now()
    where id = p_order_id;
  else
    update public.morfi_supplier_orders
    set payment_status = case when p_approved then 'verified' else 'rejected' end,
        status = case when p_approved then status else v_resolution_status end,
        updated_at = now()
    where id = p_order_id;
  end if;
end
$$;

revoke all on function public.morfi_snapshot_order_customer() from public, anon, authenticated;
revoke all on function public.morfi_block_rejected_transfer_progress() from public, anon, authenticated;
revoke all on function public.morfi_create_supplier_order(uuid, jsonb, text, text, text, uuid)
  from public, anon;
revoke all on function public.morfi_update_supplier_order_status(uuid, public.morfi_order_status)
  from public, anon;
revoke all on function public.morfi_review_transfer_payment(uuid, text, boolean)
  from public, anon;
grant execute on function public.morfi_create_supplier_order(uuid, jsonb, text, text, text, uuid)
  to authenticated;
grant execute on function public.morfi_update_supplier_order_status(uuid, public.morfi_order_status)
  to authenticated;
grant execute on function public.morfi_review_transfer_payment(uuid, text, boolean)
  to authenticated;

commit;
