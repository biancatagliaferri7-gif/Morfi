-- Orders may be placed without registering inventory. Existing stock movements
-- are returned only if a previous checkout actually deducted them.
begin;

create or replace function public.morfi_restore_order_inventory_if_deducted(
  p_order_id uuid,
  p_business_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
begin
  if exists (
    select 1 from public.morfi_inventory_movements
    where order_id = p_order_id
      and business_id = p_business_id
      and movement_type = 'order_return'
  ) then
    return;
  end if;

  for v_sale in
    select movement.product_id, movement.recipe_id,
           -sum(movement.quantity_delta)::numeric(14, 4) as quantity,
           max(movement.unit) as unit
    from public.morfi_inventory_movements movement
    where movement.order_id = p_order_id
      and movement.business_id = p_business_id
      and movement.movement_type = 'order_sale'
      and movement.quantity_delta < 0
    group by movement.product_id, movement.recipe_id
  loop
    if v_sale.recipe_id is not null then
      update public.morfi_recipes
      set finished_stock = finished_stock + v_sale.quantity,
          updated_at = now()
      where id = v_sale.recipe_id and business_id = p_business_id;
    else
      update public.morfi_business_products
      set stock_quantity = stock_quantity + v_sale.quantity::integer,
          updated_at = now()
      where id = v_sale.product_id and business_id = p_business_id;
    end if;
    if not found then
      raise exception 'Product inventory for this order is unavailable';
    end if;

    insert into public.morfi_inventory_movements (
      business_id, recipe_id, product_id, order_id, movement_type,
      quantity_delta, unit, reason, created_by
    ) values (
      p_business_id, v_sale.recipe_id, v_sale.product_id, p_order_id,
      'order_return', v_sale.quantity, v_sale.unit, p_reason, auth.uid()
    );
  end loop;
end
$$;

revoke all on function public.morfi_restore_order_inventory_if_deducted(uuid, uuid, text)
  from public, anon, authenticated;


-- status
create or replace function public.morfi_update_order_status(
  p_order_id uuid,
  p_new_status public.morfi_order_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.morfi_orders%rowtype;
  v_item record;
  v_is_business_member boolean;
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
  from public.morfi_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found';
  end if;

  v_is_business_member := public.morfi_has_business_access(
    v_order.business_id,
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

  if v_is_business_member then
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

  if p_new_status in ('rejected', 'cancelled') then
    perform public.morfi_restore_order_inventory_if_deducted(
      v_order.id, v_order.business_id,
      'Devolución por pedido ' || p_new_status::text || ' ' || left(v_order.id::text, 8)
    );
  end if;

  update public.morfi_orders
  set status = p_new_status, updated_at = now()
  where id = p_order_id;
end
$$;

-- review
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

  if p_order_type is distinct from 'business' then
    raise exception 'Only business orders are supported by this checkout migration';
  end if;

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

  if v_payment_method <> 'transfer'
    or v_payment_status not in ('pending_payment', 'pending_verification')
  then
    raise exception 'This order has no transfer payment pending manual review';
  end if;
  if p_approved
    and exists (
      select 1
      from public.morfi_orders
      where id = p_order_id
        and delivery_fee_status = 'pending'
    )
  then
    raise exception 'A delivery transfer cannot be verified before its fee is confirmed';
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

  if not p_approved then
    perform public.morfi_restore_order_inventory_if_deducted(
      p_order_id, v_workspace_id,
      'Devolución por transferencia rechazada ' || left(p_order_id::text, 8)
    );
  end if;

  update public.morfi_orders
  set payment_status = case when p_approved then 'verified' else 'rejected' end,
      status = case when p_approved then status else v_resolution_status end,
      updated_at = now()
  where id = p_order_id;
end
$$;

-- checkout
create or replace function public.morfi_create_order_v2(
  p_business_id uuid,
  p_customer_phone text,
  p_items jsonb,
  p_delivery_mode text,
  p_delivery_address text,
  p_delivery_references text,
  p_payment_method text,
  p_customer_notes text,
  p_request_key uuid
)
returns table (order_id uuid, order_number bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.morfi_businesses%rowtype;
  v_product public.morfi_business_products%rowtype;
  v_item record;
  v_order_id uuid := gen_random_uuid();
  v_subtotal numeric(12, 2) := 0;
  v_discount numeric(12, 2) := 0;
  v_line_total numeric(12, 2);
  v_delivery_fee numeric(12, 2) := 0;
  v_count integer := 0;
  v_request_fingerprint text;
  v_legacy_fingerprint text;
  v_existing_fingerprint text;
  v_existing_checkout_fingerprint text;
  v_existing_customer_phone text;
  v_normalized_items jsonb;
  v_legacy_items jsonb;
  v_has_extra_checkout_details boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_business_id is null or p_request_key is null then
    raise exception 'Business and idempotency key are required';
  end if;
  if p_customer_phone is null
    or nullif(btrim(p_customer_phone), '') is null
    or length(btrim(p_customer_phone)) > 16
    or btrim(p_customer_phone) !~ '^\+[1-9][0-9]{7,14}$'
  then
    raise exception 'A valid customer phone number is required';
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
        when coalesce(entry ->> 'quantity', '') ~ '^[1-9][0-9]*$'
          then (entry ->> 'quantity')::numeric > 10000
        else true
      end
      or (
        entry ? 'customer_notes'
        and jsonb_typeof(entry -> 'customer_notes') not in ('string', 'null')
      )
      or length(btrim(coalesce(entry ->> 'customer_notes', ''))) > 500
  ) then
    raise exception 'Each product needs a valid id, quantity, and optional note up to 500 characters';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as entries(entry)
    group by (entry ->> 'product_id')
    having sum((entry ->> 'quantity')::numeric) > 10000
  ) then
    raise exception 'Combined quantity for a product cannot exceed 10000';
  end if;
  if p_delivery_mode is null or p_delivery_mode not in ('pickup', 'delivery') then
    raise exception 'Unsupported delivery mode';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'transfer') then
    raise exception 'Unsupported payment method';
  end if;
  if p_customer_notes is not null and length(btrim(p_customer_notes)) > 1000 then
    raise exception 'Order notes cannot exceed 1000 characters';
  end if;
  if p_delivery_references is not null and length(btrim(p_delivery_references)) > 300 then
    raise exception 'Delivery references cannot exceed 300 characters';
  end if;
  if p_delivery_mode = 'delivery'
    and (nullif(btrim(p_delivery_address), '') is null
      or length(btrim(p_delivery_address)) > 300)
  then
    raise exception 'A valid delivery address up to 300 characters is required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', entry.value -> 'product_id',
        'quantity', entry.value -> 'quantity',
        'customer_notes', nullif(btrim(entry.value ->> 'customer_notes'), '')
      )
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
  into v_normalized_items
  from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', entry.value -> 'product_id',
        'quantity', entry.value -> 'quantity'
      )
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
  into v_legacy_items
  from jsonb_array_elements(v_normalized_items) with ordinality as entry(value, ordinality);

  v_legacy_fingerprint := md5(concat_ws(
    '|',
    p_business_id::text,
    v_legacy_items::text,
    p_delivery_mode,
    coalesce(p_delivery_address, ''),
    p_payment_method
  ));

  v_request_fingerprint := md5(jsonb_build_object(
    'business_id', p_business_id,
    'items', v_normalized_items,
    'delivery_mode', p_delivery_mode,
    'delivery_address', nullif(btrim(p_delivery_address), ''),
    'delivery_references', nullif(btrim(p_delivery_references), ''),
    'payment_method', p_payment_method,
    'customer_phone', btrim(p_customer_phone),
    'customer_notes', nullif(btrim(p_customer_notes), '')
  )::text);

  select id, request_fingerprint, checkout_fingerprint, customer_phone_snapshot
  into v_order_id, v_existing_fingerprint, v_existing_checkout_fingerprint, v_existing_customer_phone
  from public.morfi_orders
  where customer_id = auth.uid() and request_key = p_request_key;
  if found then
    v_has_extra_checkout_details :=
      nullif(btrim(p_delivery_references), '') is not null
      or nullif(btrim(p_customer_notes), '') is not null
      or exists (
        select 1
        from jsonb_array_elements(v_normalized_items) as entries(entry)
        where nullif(btrim(entry ->> 'customer_notes'), '') is not null
      );

    if v_existing_checkout_fingerprint is not null then
      if v_existing_checkout_fingerprint <> v_request_fingerprint then
        raise exception 'This request key was already used for a different order';
      end if;
    elsif v_existing_fingerprint = v_legacy_fingerprint
      and not v_has_extra_checkout_details
      and regexp_replace(coalesce(v_existing_customer_phone, ''), '\D', '', 'g')
        = regexp_replace(btrim(p_customer_phone), '\D', '', 'g')
    then
      return query
      select order_record.id, order_record.order_number
      from public.morfi_orders order_record
      where order_record.id = v_order_id;
      return;
    else
      raise exception 'This request key was already used for a different order';
    end if;

    return query
    select order_record.id, order_record.order_number
    from public.morfi_orders order_record
    where order_record.id = v_order_id;
    return;
  end if;
  v_order_id := gen_random_uuid();

  select *
  into v_business
  from public.morfi_businesses
  where id = p_business_id and is_published and is_open
  for share;
  if not found then
    raise exception 'Business is unavailable';
  end if;
  if not exists (
    select 1
    from public.morfi_public_business_contact(v_business.id) as business_contact
    where nullif(btrim(business_contact.contact_phone), '') is not null
  ) then
    raise exception 'A public WhatsApp contact is required to receive MORFI orders';
  end if;
  if p_delivery_mode = 'delivery' then
    if not v_business.accepts_delivery then
      raise exception 'Delivery is unavailable for this business';
    end if;
    if v_business.delivery_fee_status not in ('pending', 'free', 'fixed') then
      raise exception 'Business delivery fee configuration is invalid';
    end if;
    if v_business.delivery_fee_status = 'fixed' then
      v_delivery_fee := v_business.delivery_fee;
    elsif v_business.delivery_fee_status = 'free' then
      v_delivery_fee := 0;
    else
      v_delivery_fee := null;
    end if;
  elsif not v_business.accepts_pickup then
    raise exception 'Pickup is unavailable for this business';
  end if;

  perform set_config('morfi.checkout_v2', 'on', true);

  insert into public.morfi_orders (
    id, customer_id, business_id, request_key, request_fingerprint, checkout_fingerprint,
    delivery_mode, delivery_address, delivery_references, customer_notes,
    payment_method, delivery_fee, delivery_fee_status
  )
  values (
    v_order_id,
    auth.uid(),
    v_business.id,
    p_request_key,
    v_legacy_fingerprint,
    v_request_fingerprint,
    p_delivery_mode,
    case when p_delivery_mode = 'delivery' then btrim(p_delivery_address) end,
    nullif(btrim(p_delivery_references), ''),
    nullif(btrim(p_customer_notes), ''),
    p_payment_method,
    v_delivery_fee,
    case
      when p_delivery_mode = 'pickup' then 'not_applicable'
      else v_business.delivery_fee_status
    end
  )
  on conflict (customer_id, request_key) do nothing;
  if not found then
    select id, request_fingerprint, checkout_fingerprint, customer_phone_snapshot
    into v_order_id, v_existing_fingerprint, v_existing_checkout_fingerprint, v_existing_customer_phone
    from public.morfi_orders
    where customer_id = auth.uid() and request_key = p_request_key;
    if v_existing_checkout_fingerprint is not null then
      if v_existing_checkout_fingerprint <> v_request_fingerprint then
        raise exception 'This request key was already used for a different order';
      end if;
    elsif v_existing_fingerprint = v_legacy_fingerprint
      and regexp_replace(coalesce(v_existing_customer_phone, ''), '\D', '', 'g')
        = regexp_replace(btrim(p_customer_phone), '\D', '', 'g')
    then
      v_has_extra_checkout_details :=
        nullif(btrim(p_delivery_references), '') is not null
        or nullif(btrim(p_customer_notes), '') is not null
        or exists (
          select 1
          from jsonb_array_elements(v_normalized_items) as entries(entry)
          where nullif(btrim(entry ->> 'customer_notes'), '') is not null
        );
      if v_has_extra_checkout_details then
        raise exception 'This request key belongs to a legacy order without checkout notes';
      end if;
    else
      raise exception 'This request key was already used for a different order';
    end if;
    return query
    select order_record.id, order_record.order_number
    from public.morfi_orders order_record
    where order_record.id = v_order_id;
    return;
  end if;

  update public.morfi_orders
  set customer_phone_snapshot = btrim(p_customer_phone)
  where id = v_order_id and customer_id = auth.uid();

  if not exists (
    select 1
    from public.morfi_orders order_record
    where order_record.id = v_order_id
      and nullif(btrim(order_record.customer_name_snapshot), '') is not null
      and nullif(btrim(order_record.customer_phone_snapshot), '') is not null
  ) then
    raise exception 'A customer name and phone number are required to place a MORFI order';
  end if;

  -- Keep the existing server-side product, price, discount, and stock checks.
  for v_item in
    select
      (entry ->> 'product_id')::uuid as product_id,
      sum((entry ->> 'quantity')::integer)::integer as quantity,
      nullif(
        string_agg(
          distinct nullif(btrim(entry ->> 'customer_notes'), ''),
          E'\n'
          order by nullif(btrim(entry ->> 'customer_notes'), '')
        ),
        ''
      ) as customer_notes
    from jsonb_array_elements(v_normalized_items) as entries(entry)
    group by (entry ->> 'product_id')::uuid
    order by (entry ->> 'product_id')::uuid
  loop
    if v_item.quantity > 10000 then
      raise exception 'Combined quantity for a product cannot exceed 10000';
    end if;
    if v_item.customer_notes is not null and length(v_item.customer_notes) > 500 then
      raise exception 'Combined product notes cannot exceed 500 characters';
    end if;

    select *
    into v_product
    from public.morfi_business_products
    where id = v_item.product_id
      and business_id = v_business.id
      and is_available
    for update;
    if not found then
      raise exception 'A product is unavailable or does not belong to this business';
    end if;
    if p_delivery_mode = 'delivery' and not v_product.accepts_delivery then
      raise exception 'A product in this order is not available for delivery';
    end if;
    if not (p_payment_method = any(v_product.payment_methods)) then
      raise exception 'A product in this order does not accept the selected payment method';
    end if;

    v_line_total := round(
      v_product.price * v_item.quantity
      * (1 - case
        when p_payment_method = 'cash' then coalesce(v_product.cash_discount_percent, 0) / 100
        else 0
      end),
      2
    );
    v_subtotal := v_subtotal + v_product.price * v_item.quantity;
    v_discount := v_discount + (v_product.price * v_item.quantity - v_line_total);

    -- Availability is controlled by is_available, not inventory quantities.
    -- Inventory remains an optional tool; this order does not change it.

    insert into public.morfi_order_items (
      order_id, business_id, product_id, recipe_id, product_name, quantity,
      unit_price, cash_discount_percent, line_total, customer_notes
    )
    values (
      v_order_id,
      v_business.id,
      v_product.id,
      v_product.recipe_id,
      v_product.name,
      v_item.quantity,
      v_product.price,
      case when p_payment_method = 'cash' then v_product.cash_discount_percent else null end,
      v_line_total,
      v_item.customer_notes
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'At least one valid product is required';
  end if;

  update public.morfi_orders
  set subtotal = round(v_subtotal, 2),
      discount_total = round(v_discount, 2),
      total = case
        when delivery_fee_status = 'pending' then null
        else round(v_subtotal - v_discount + coalesce(delivery_fee, 0), 2)
      end,
      payment_status = case
        when payment_method = 'transfer' then 'pending_payment'
        else 'awaiting_collection'
      end,
      updated_at = now()
  where id = v_order_id;

  return query
  select order_record.id, order_record.order_number
  from public.morfi_orders order_record
  where order_record.id = v_order_id;
end
$$;

commit;
