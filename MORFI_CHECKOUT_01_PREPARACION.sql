-- MORFI unified checkout and delivery quote migration.
-- Preconditions are checked before changes; all DDL/DML is in one transaction.
-- Apply only after reviewing against the production schema. Do not run until approved.
begin;
do $$
declare
  v_missing_columns text;
begin
  if to_regclass('public.morfi_businesses') is null
    or to_regclass('public.morfi_profiles') is null
    or to_regclass('public.morfi_orders') is null
    or to_regclass('public.morfi_order_items') is null
    or to_regclass('public.morfi_business_products') is null
    or to_regclass('public.morfi_recipes') is null
    or to_regclass('public.morfi_inventory_movements') is null
  then
    raise exception 'Required MORFI business, order, product, recipe, or inventory tables are missing';
  end if;

  if to_regprocedure('public.morfi_create_order(uuid,jsonb,text,text,text,uuid)') is null
    or to_regprocedure('public.morfi_has_business_access(uuid,public.morfi_workspace_role[])') is null
    or to_regprocedure('public.morfi_snapshot_order_customer()') is null
    or to_regprocedure('public.morfi_set_updated_at()') is null
    or to_regprocedure('public.morfi_update_order_status(uuid,public.morfi_order_status)') is null
  then
    raise exception 'Required legacy order, status, and business access functions are missing';
  end if;

  select string_agg(format('%I.%I', required.table_name, required.column_name), ', ')
  into v_missing_columns
  from (values
    ('morfi_profiles', 'id'),
    ('morfi_profiles', 'phone'),
    ('morfi_businesses', 'id'),
    ('morfi_businesses', 'phone_is_public'),
    ('morfi_businesses', 'email_is_public'),
    ('morfi_businesses', 'contact_phone'),
    ('morfi_businesses', 'contact_email'),
    ('morfi_businesses', 'created_by'),
    ('morfi_businesses', 'name'),
    ('morfi_businesses', 'description'),
    ('morfi_businesses', 'bank_name'),
    ('morfi_businesses', 'bank_cuit'),
    ('morfi_businesses', 'transfer_alias'),
    ('morfi_businesses', 'transfer_holder'),
    ('morfi_businesses', 'location'),
    ('morfi_businesses', 'directions'),
    ('morfi_businesses', 'delivery_fee'),
    ('morfi_businesses', 'updated_at'),
    ('morfi_orders', 'id'),
    ('morfi_orders', 'business_id'),
    ('morfi_orders', 'customer_id'),
    ('morfi_orders', 'customer_name_snapshot'),
    ('morfi_orders', 'customer_phone_snapshot'),
    ('morfi_orders', 'delivery_mode'),
    ('morfi_orders', 'delivery_address'),
    ('morfi_orders', 'payment_method'),
    ('morfi_orders', 'payment_status'),
    ('morfi_orders', 'subtotal'),
    ('morfi_orders', 'discount_total'),
    ('morfi_orders', 'delivery_fee'),
    ('morfi_orders', 'total'),
    ('morfi_orders', 'status'),
    ('morfi_orders', 'created_at'),
    ('morfi_orders', 'updated_at'),
    ('morfi_order_items', 'order_id'),
    ('morfi_order_items', 'business_id'),
    ('morfi_order_items', 'product_id'),
    ('morfi_order_items', 'recipe_id'),
    ('morfi_order_items', 'quantity'),
    ('morfi_business_products', 'id'),
    ('morfi_business_products', 'business_id'),
    ('morfi_business_products', 'stock_quantity'),
    ('morfi_business_products', 'updated_at'),
    ('morfi_recipes', 'id'),
    ('morfi_recipes', 'business_id'),
    ('morfi_recipes', 'finished_stock'),
    ('morfi_recipes', 'yield_unit'),
    ('morfi_recipes', 'updated_at'),
    ('morfi_inventory_movements', 'business_id'),
    ('morfi_inventory_movements', 'recipe_id'),
    ('morfi_inventory_movements', 'product_id'),
    ('morfi_inventory_movements', 'order_id'),
    ('morfi_inventory_movements', 'movement_type'),
    ('morfi_inventory_movements', 'quantity_delta'),
    ('morfi_inventory_movements', 'unit'),
    ('morfi_inventory_movements', 'reason'),
    ('morfi_inventory_movements', 'created_by')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns actual
    where actual.table_schema = 'public'
      and actual.table_name = required.table_name
      and actual.column_name = required.column_name
  );

  if v_missing_columns is not null then
    raise exception 'Required pre-migration columns are missing: %', v_missing_columns;
  end if;

  if has_column_privilege('anon', 'public.morfi_businesses', 'bank_name', 'SELECT')
    or has_column_privilege('anon', 'public.morfi_businesses', 'bank_cuit', 'SELECT')
    or has_column_privilege('anon', 'public.morfi_businesses', 'transfer_alias', 'SELECT')
    or has_column_privilege('anon', 'public.morfi_businesses', 'transfer_holder', 'SELECT')
    or has_column_privilege('authenticated', 'public.morfi_businesses', 'bank_name', 'SELECT')
    or has_column_privilege('authenticated', 'public.morfi_businesses', 'bank_cuit', 'SELECT')
    or has_column_privilege('authenticated', 'public.morfi_businesses', 'transfer_alias', 'SELECT')
    or has_column_privilege('authenticated', 'public.morfi_businesses', 'transfer_holder', 'SELECT')
  then
    raise exception 'Bank details must not be directly selectable; expose only the transfer alias through its public RPC';
  end if;

  if to_regprocedure('public.morfi_public_business_contact(uuid)') is null
    or not has_function_privilege(
      'anon', to_regprocedure('public.morfi_public_business_contact(uuid)'), 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', to_regprocedure('public.morfi_public_business_contact(uuid)'), 'EXECUTE'
    )
  then
    raise exception 'The existing public business contact RPC is required for checkout';
  end if;

  if exists (
    select 1
    from pg_proc function_row
    where function_row.oid = to_regprocedure('public.morfi_public_business_contact(uuid)')
      and not function_row.prosecdef
  ) or exists (
    select 1
    from pg_proc function_row
    cross join lateral aclexplode(
      coalesce(function_row.proacl, acldefault('f', function_row.proowner))
    ) privilege
    where function_row.oid = to_regprocedure('public.morfi_public_business_contact(uuid)')
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'The public business contact RPC must be SECURITY DEFINER and not executable by PUBLIC';
  end if;
  if to_regtype('public.morfi_workspace_role') is null
    or to_regtype('public.morfi_order_status') is null
  then
    raise exception 'Required MORFI role or order status types are missing';
  end if;

  if exists (
    select required.enum_label
    from (values
      ('pending'),
      ('accepted'),
      ('preparing'),
      ('ready'),
      ('on_the_way'),
      ('delivered'),
      ('rejected'),
      ('cancellation_requested'),
      ('cancelled')
    ) as required(enum_label)
    where not exists (
      select 1
      from pg_enum enum_row
      join pg_type type_row on type_row.oid = enum_row.enumtypid
      join pg_namespace namespace_row on namespace_row.oid = type_row.typnamespace
      where namespace_row.nspname = 'public'
        and type_row.typname = 'morfi_order_status'
        and enum_row.enumlabel::text = required.enum_label
    )
  ) then
    raise exception 'The order status type is missing labels required for existing order transitions';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'morfi_orders_customer_snapshot'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'Apply the existing customer snapshot migration before this migration';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_payment_status_valid'
  ) then
    raise exception 'The current payment status constraint is required before this migration';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'morfi_orders_updated_at'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'The current order updated_at trigger is required before this migration';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_businesses'::regclass
      and tgname = 'morfi_businesses_updated_at'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'The current business updated_at trigger is required before this migration';
  end if;

  if exists (
    select 1
    from public.morfi_orders
    where payment_status is null
      or payment_status not in (
      'not_applicable',
      'awaiting_collection',
      'pending_verification',
      'pending_payment',
      'verified',
      'rejected',
      'awaiting_delivery_quote'
    )
  ) then
    raise exception 'Existing payment_status values need review before extending the constraint';
  end if;
end
$$;

-- Remove only the unavailable business-level payment-method check from the
-- legacy RPC; item-level payment validation and all existing order behavior stay intact.
do $$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    to_regprocedure('public.morfi_create_order(uuid,jsonb,text,text,text,uuid)')
  )
  into v_definition;

  v_updated_definition := regexp_replace(
    v_definition,
    $pattern$if not \(p_payment_method = any\(v_business\.payment_method\)\) then[[:space:]]+raise exception 'Payment method is unavailable for this business';[[:space:]]+end if;$pattern$,
    '',
    'gi'
  );

  if v_updated_definition is not distinct from v_definition
    and v_definition ~* 'v_business\.payment_method'
  then
    raise exception 'The legacy order RPC does not contain the expected business payment-method check; no function was changed';
  end if;
  if v_updated_definition ~* 'v_business\.payment_method' then
    raise exception 'The legacy order RPC still depends on the missing business payment-method column';
  end if;

  if v_updated_definition is distinct from v_definition then
    execute v_updated_definition;
  end if;
end
$$;

  -- Keep entrepreneur signup functional without writing the removed business
  -- payment-method column. The account-level form validation remains unchanged.
  create or replace function public.morfi_create_business_from_signup()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare
    v_enabled_panels jsonb := new.raw_user_meta_data -> 'enabled_panels';
    v_name text := nullif(btrim(new.raw_user_meta_data ->> 'business_name'), '');
    v_description text := coalesce(btrim(new.raw_user_meta_data ->> 'business_description'), '');
    v_location text := nullif(btrim(new.raw_user_meta_data ->> 'business_location'), '');
    v_payment_methods text[];
    v_bank_name text := nullif(btrim(new.raw_user_meta_data ->> 'business_bank_name'), '');
    v_transfer_alias text := nullif(btrim(new.raw_user_meta_data ->> 'business_transfer_alias'), '');
    v_transfer_holder text := nullif(btrim(new.raw_user_meta_data ->> 'business_transfer_holder'), '');
    v_bank_cuit text := nullif(new.raw_user_meta_data ->> 'business_bank_cuit', '');
  begin
    if jsonb_typeof(v_enabled_panels) is distinct from 'array'
      or not (v_enabled_panels ? 'emprendimiento')
    then
      return new;
    end if;

    if v_name is null or length(v_name) > 120 then
      raise exception 'A valid business name is required';
    end if;
    if length(v_description) > 2000 then
      raise exception 'The business description is too long';
    end if;
    if v_location is null or length(v_location) > 180 then
      raise exception 'A valid business address is required';
    end if;
    if coalesce(new.raw_user_meta_data ->> 'phone', '') !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'A valid business contact phone is required';
    end if;
    if jsonb_typeof(new.raw_user_meta_data -> 'business_payment_methods') is distinct from 'array' then
      raise exception 'At least one valid business payment method is required';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(new.raw_user_meta_data -> 'business_payment_methods') as methods(method)
      where method is null or method not in ('cash', 'transfer')
    ) then
      raise exception 'The business payment method is invalid';
    end if;

    select coalesce(array_agg(distinct method order by method), array[]::text[])
    into v_payment_methods
    from jsonb_array_elements_text(new.raw_user_meta_data -> 'business_payment_methods') as methods(method);

    if cardinality(v_payment_methods) = 0 then
      raise exception 'At least one valid business payment method is required';
    end if;
    if 'transfer' = any(v_payment_methods) and (
      v_bank_name is null
      or length(v_bank_name) > 120
      or v_transfer_alias is null
      or length(v_transfer_alias) > 120
      or v_transfer_holder is null
      or length(v_transfer_holder) > 120
      or v_bank_cuit is null
      or v_bank_cuit !~ '^[0-9]{11}$'
    ) then
      raise exception 'Complete the bank, alias, account holder, and valid CUIT for transfers';
    end if;

    insert into public.morfi_businesses (
      created_by,
      name,
      description,
      contact_phone,
      phone_is_public,
      location,
      bank_name,
      bank_cuit,
      transfer_alias,
      transfer_holder
    )
    values (
      new.id,
      v_name,
      v_description,
      new.raw_user_meta_data ->> 'phone',
      true,
      v_location,
      case when 'transfer' = any(v_payment_methods) then v_bank_name end,
      case when 'transfer' = any(v_payment_methods) then v_bank_cuit end,
      case when 'transfer' = any(v_payment_methods) then v_transfer_alias end,
      case when 'transfer' = any(v_payment_methods) then v_transfer_holder end
    );

    return new;
  end
  $$;

  revoke all on function public.morfi_create_business_from_signup()
    from public, anon, authenticated;

  alter table public.morfi_orders
    add column if not exists status_reason text;

-- A configured business WhatsApp is public for catalog and order delivery.
-- The public contact function below still returns it only for published businesses.
update public.morfi_businesses
set phone_is_public = true
where nullif(btrim(contact_phone), '') is not null
  and phone_is_public is distinct from true;

create or replace function public.morfi_public_business_contact(p_business_id uuid)
returns table (
  contact_phone text,
  contact_email text,
  transfer_alias text,
  transfer_holder text,
  location text,
  directions text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when business.phone_is_public then business.contact_phone end,
    case when business.email_is_public then business.contact_email end,
    null::text,
    null::text,
    business.location,
    business.directions
  from public.morfi_businesses business
  where business.id = p_business_id and business.is_published
$$;

revoke all on function public.morfi_public_business_contact(uuid)
  from public, anon, authenticated;
grant execute on function public.morfi_public_business_contact(uuid)
  to anon, authenticated;

create or replace function public.morfi_public_business_transfer_alias(
  p_business_id uuid
)
returns table (transfer_alias text)
language sql
stable
security definer
set search_path = ''
as $$
  select business.transfer_alias
  from public.morfi_businesses business
  where business.id = p_business_id
    and business.is_published
    and nullif(btrim(business.transfer_alias), '') is not null
$$;

revoke all on function public.morfi_public_business_transfer_alias(uuid)
  from public, anon, authenticated;

-- Keep the legacy function signature, but stop exposing bank names publicly.
do $$
begin
  if to_regprocedure('public.morfi_public_business_payment_details(uuid)') is not null then
    execute 'revoke all on function public.morfi_public_business_payment_details(uuid) from public, anon, authenticated';
  end if;
end
$$;

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
declare
  v_order public.morfi_orders%rowtype;
  v_is_business_member boolean;
  v_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_order_id is null or p_new_status is null then
    raise exception 'An order and new status are required';
  end if;
  if p_reason is not null and length(btrim(p_reason)) > 500 then
    raise exception 'The order status reason is too long';
  end if;
  if p_new_status = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'A rejection reason is required';
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
  if v_order.delivery_mode = 'delivery'
    and v_order.delivery_fee_status = 'pending'
    and p_new_status in ('on_the_way', 'delivered')
  then
    raise exception 'A delivery order needs a confirmed delivery fee before it can be dispatched or delivered';
  end if;
  if v_order.payment_status = 'rejected'
    and p_new_status not in ('rejected', 'cancelled', 'cancellation_requested')
  then
    raise exception 'An order with a rejected transfer cannot advance without an explicit resolution';
  end if;

  update public.morfi_orders
  set status_reason = case
    when p_new_status in ('rejected', 'cancelled', 'cancellation_requested')
      then nullif(btrim(p_reason), '')
    else null
  end
  where id = p_order_id;

  if not found then
    raise exception 'Order not found';
  end if;

  perform public.morfi_update_order_status(p_order_id, p_new_status);
end
$$;

revoke all on function public.morfi_update_order_status_with_reason(
  uuid, public.morfi_order_status, text
) from public, anon;
grant execute on function public.morfi_update_order_status_with_reason(
  uuid, public.morfi_order_status, text
) to authenticated;

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
end
$$;

revoke all on function public.morfi_review_transfer_payment(uuid, text, boolean)
  from public, anon;
grant execute on function public.morfi_review_transfer_payment(uuid, text, boolean)
  to authenticated;

commit;
