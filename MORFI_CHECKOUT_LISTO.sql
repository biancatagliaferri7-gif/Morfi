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
    raise exception 'Bank details must not be directly selectable by clients';
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


-- A zero in the old business configuration is ambiguous. Treat it as pending,
-- while leaving every existing order's amount and status untouched.
alter table public.morfi_businesses
  add column if not exists delivery_fee_status text;

alter table public.morfi_businesses disable trigger morfi_businesses_updated_at;

update public.morfi_businesses
set delivery_fee_status = case
  when delivery_fee > 0 then 'fixed'
  else 'pending'
end
where delivery_fee_status is null;

alter table public.morfi_businesses enable trigger morfi_businesses_updated_at;

alter table public.morfi_businesses
  alter column delivery_fee_status set default 'pending',
  alter column delivery_fee_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_delivery_fee_status_valid'
  ) then
    alter table public.morfi_businesses
      add constraint morfi_businesses_delivery_fee_status_valid
      check (
        (delivery_fee_status = 'pending' and delivery_fee = 0)
        or (delivery_fee_status = 'free' and delivery_fee = 0)
        or (delivery_fee_status = 'fixed' and delivery_fee > 0)
      );
  end if;
end
$$;

-- Expose only the non-sensitive delivery quote state alongside public catalog data.
grant select (delivery_fee_status)
  on public.morfi_businesses to anon, authenticated;

alter table public.morfi_orders
  add column if not exists delivery_references text,
  add column if not exists customer_notes text,
  add column if not exists delivery_fee_status text,
  add column if not exists transfer_bank_snapshot text,
  add column if not exists transfer_alias_snapshot text,
  add column if not exists transfer_holder_snapshot text,
  add column if not exists order_number bigint,
  add column if not exists checkout_fingerprint text;

alter table public.morfi_order_items
  add column if not exists customer_notes text;

-- Keep old numeric values intact; only new pending quotes may have unknown totals.
alter table public.morfi_orders
  alter column delivery_fee drop not null,
  alter column total drop not null;

alter table public.morfi_orders disable trigger morfi_orders_updated_at;

update public.morfi_orders
set delivery_fee_status = 'legacy'
where delivery_fee_status is null;

alter table public.morfi_orders
  alter column delivery_fee_status set default 'legacy',
  alter column delivery_fee_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_delivery_fee_status_valid'
  ) then
    alter table public.morfi_orders
      add constraint morfi_orders_delivery_fee_status_valid
      check (
        delivery_fee_status in ('pending', 'free', 'fixed', 'not_applicable', 'legacy')
        and (
          delivery_fee_status = 'legacy'
          or (
            delivery_fee_status = 'pending'
            and delivery_mode = 'delivery'
            and delivery_fee is null
            and total is null
          )
          or (
            delivery_fee_status = 'free'
            and delivery_mode = 'delivery'
            and delivery_fee = 0
            and total is not null
          )
          or (
            delivery_fee_status = 'fixed'
            and delivery_mode = 'delivery'
            and delivery_fee > 0
            and total is not null
          )
          or (
            delivery_fee_status = 'not_applicable'
            and delivery_mode = 'pickup'
            and delivery_fee = 0
            and total is not null
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_checkout_text_lengths'
  ) then
    alter table public.morfi_orders
      add constraint morfi_orders_checkout_text_lengths
      check (
        (delivery_references is null or length(delivery_references) <= 300)
        and (customer_notes is null or length(customer_notes) <= 1000)
        and (transfer_bank_snapshot is null or length(transfer_bank_snapshot) <= 120)
        and (transfer_alias_snapshot is null or length(transfer_alias_snapshot) <= 120)
        and (transfer_holder_snapshot is null or length(transfer_holder_snapshot) <= 120)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_order_items'::regclass
      and conname = 'morfi_order_items_customer_notes_length'
  ) then
    alter table public.morfi_order_items
      add constraint morfi_order_items_customer_notes_length
      check (customer_notes is null or length(customer_notes) <= 500);
  end if;
end
$$;

-- New transfer orders remain unpaid until the seller optionally reviews them.
alter table public.morfi_orders
  drop constraint if exists morfi_orders_payment_status_valid;

alter table public.morfi_orders
  add constraint morfi_orders_payment_status_valid
  check (payment_status in (
    'not_applicable',
    'awaiting_collection',
    'awaiting_delivery_quote',
    'pending_verification',
    'pending_payment',
    'verified',
    'rejected'
  ));

do $$
begin
  alter table public.morfi_orders
    drop constraint if exists morfi_orders_delivery_quote_payment_guard;

  alter table public.morfi_orders
    add constraint morfi_orders_delivery_quote_payment_guard
    check (
      delivery_fee_status <> 'pending'
      or (
        delivery_mode = 'delivery'
        and (
          (payment_method = 'transfer' and payment_status in ('pending_payment', 'awaiting_delivery_quote'))
          or (payment_method = 'cash' and payment_status = 'awaiting_collection')
        )
      )
    );

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_checkout_fingerprint_length'
  ) then
    alter table public.morfi_orders
      add constraint morfi_orders_checkout_fingerprint_length
      check (checkout_fingerprint is null or length(checkout_fingerprint) = 32);
  end if;
end
$$;

-- Assign visible, persistent numbers to old and new orders. Existing order IDs,
-- financial values, statuses, and timestamps are not changed by this backfill.
create sequence if not exists public.morfi_order_number_seq;

alter table public.morfi_orders
  alter column order_number
  set default nextval('public.morfi_order_number_seq'::regclass);

with current_max as (
  select coalesce(max(order_number), 0) as last_number
  from public.morfi_orders
), numbered_orders as (
  select order_record.id,
    current_max.last_number
      + row_number() over (order by order_record.created_at, order_record.id) as assigned_number
  from public.morfi_orders order_record
  cross join current_max
  where order_record.order_number is null
)
update public.morfi_orders order_record
set order_number = numbered_orders.assigned_number
from numbered_orders
where order_record.id = numbered_orders.id;

alter table public.morfi_orders enable trigger morfi_orders_updated_at;

do $$
declare
  v_next_number bigint;
begin
  select coalesce(max(order_number), 0) + 1
  into v_next_number
  from public.morfi_orders;

  execute format(
    'alter sequence public.morfi_order_number_seq restart with %s',
    v_next_number
  );
end
$$;

alter table public.morfi_orders
  alter column order_number set not null;

create unique index if not exists morfi_orders_order_number_unique
  on public.morfi_orders (order_number);

create or replace function public.morfi_prepare_order_checkout_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.morfi_businesses%rowtype;
begin
  if current_setting('morfi.checkout_v2', true) is distinct from 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.order_number is null then
      new.order_number := nextval('public.morfi_order_number_seq'::regclass);
    end if;

    select *
    into v_business
    from public.morfi_businesses
    where id = new.business_id;
    if not found then
      raise exception 'Business is unavailable';
    end if;

    if new.delivery_mode = 'pickup' then
      new.delivery_fee_status := 'not_applicable';
      new.delivery_fee := 0;
    else
      new.delivery_fee_status := v_business.delivery_fee_status;
      if v_business.delivery_fee_status = 'pending' then
        new.delivery_fee := null;
        new.total := null;
      elsif v_business.delivery_fee_status = 'free' then
        new.delivery_fee := 0;
      elsif v_business.delivery_fee_status = 'fixed' then
        new.delivery_fee := v_business.delivery_fee;
      else
        raise exception 'Business delivery fee configuration is invalid';
      end if;
    end if;

    if new.payment_method = 'transfer' then
      new.transfer_alias_snapshot := null;
      new.transfer_holder_snapshot := null;
      new.transfer_bank_snapshot := null;
    end if;
    if new.delivery_fee_status = 'pending' then
      new.payment_status := case
        when new.payment_method = 'transfer' then 'pending_payment'
        else 'awaiting_collection'
      end;
    elsif new.payment_method = 'transfer' then
      new.payment_status := 'pending_payment';
    end if;
    return new;
  end if;

  if new.delivery_fee_status = 'pending' then
    new.delivery_fee := null;
    new.total := null;
    new.payment_status := case
      when new.payment_method = 'transfer' then 'pending_payment'
      else 'awaiting_collection'
    end;
  elsif new.delivery_fee_status = 'not_applicable' then
    new.delivery_fee := 0;
    new.total := round(new.subtotal - new.discount_total, 2);
  elsif new.delivery_fee_status = 'free' then
    new.delivery_fee := 0;
    new.total := round(new.subtotal - new.discount_total, 2);
    if old.delivery_fee_status = 'pending' then
      new.payment_status := case
        when new.payment_method = 'transfer' then 'pending_payment'
        else 'awaiting_collection'
      end;
    end if;
  elsif new.delivery_fee_status = 'fixed' then
    if new.delivery_fee is null or new.delivery_fee <= 0 then
      raise exception 'A positive delivery fee is required for a fixed quote';
    end if;
    new.total := round(new.subtotal - new.discount_total + new.delivery_fee, 2);
    if old.delivery_fee_status = 'pending' then
      new.payment_status := case
        when new.payment_method = 'transfer' then 'pending_payment'
        else 'awaiting_collection'
      end;
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.morfi_prepare_order_checkout_snapshots()
  from public, anon, authenticated;

drop trigger if exists zz_morfi_orders_checkout_prepare_insert on public.morfi_orders;
create trigger zz_morfi_orders_checkout_prepare_insert
before insert on public.morfi_orders
for each row execute function public.morfi_prepare_order_checkout_snapshots();

drop trigger if exists zz_morfi_orders_checkout_prepare_update on public.morfi_orders;
create trigger zz_morfi_orders_checkout_prepare_update
before update of subtotal, discount_total, total, delivery_fee, delivery_mode, delivery_fee_status
on public.morfi_orders
for each row execute function public.morfi_prepare_order_checkout_snapshots();

create or replace function public.morfi_block_delivery_progress_without_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.delivery_mode = 'delivery'
    and new.delivery_fee_status = 'pending'
    and new.status in (
      'on_the_way'::public.morfi_order_status,
      'delivered'::public.morfi_order_status
    )
  then
    raise exception 'A delivery order needs a confirmed delivery fee before it can be dispatched or delivered';
  end if;

  return new;
end
$$;

revoke all on function public.morfi_block_delivery_progress_without_quote()
  from public, anon, authenticated;

drop trigger if exists morfi_orders_block_delivery_progress_without_quote on public.morfi_orders;
create trigger morfi_orders_block_delivery_progress_without_quote
before update of status on public.morfi_orders
for each row execute function public.morfi_block_delivery_progress_without_quote();

-- Checkout RPC preflight and versioned routines; legacy morfi_create_order is unchanged.


do $$
declare
  v_missing_columns text;
begin
  if to_regprocedure('public.morfi_create_order(uuid,jsonb,text,text,text,uuid)') is null
    or to_regprocedure('public.morfi_has_business_access(uuid,public.morfi_workspace_role[])') is null
    or to_regprocedure('public.morfi_update_order_status_with_reason(uuid,public.morfi_order_status,text)') is null
    or to_regprocedure('public.morfi_review_transfer_payment(uuid,text,boolean)') is null
    or to_regprocedure('auth.uid()') is null
  then
    raise exception 'Required order, payment-review, auth, or business-access functions are missing';
  end if;

  if to_regclass('public.morfi_businesses') is null
    or to_regclass('public.morfi_orders') is null
    or to_regclass('public.morfi_order_items') is null
    or to_regclass('public.morfi_business_products') is null
    or to_regclass('public.morfi_recipes') is null
    or to_regclass('public.morfi_inventory_movements') is null
  then
    raise exception 'Required MORFI business, order, product, recipe, or inventory tables are missing';
  end if;

  if to_regtype('public.morfi_workspace_role') is null
    or to_regtype('public.morfi_order_status') is null
  then
    raise exception 'Required MORFI role or order status types are missing';
  end if;

  if to_regclass('public.morfi_order_number_seq') is null
    or to_regprocedure('public.morfi_prepare_order_checkout_snapshots()') is null
  then
    raise exception 'The checkout order-number sequence and snapshot trigger function are required';
  end if;

  if exists (
    select required.enum_label
    from (values ('pending'), ('accepted'), ('preparing'), ('ready')) as required(enum_label)
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
    raise exception 'The order status type must include pending, accepted, preparing, and ready';
  end if;

  select string_agg(format('%I.%I', required.table_name, required.column_name), ', ')
  into v_missing_columns
  from (values
    ('morfi_businesses', 'id'),
    ('morfi_businesses', 'is_published'),
    ('morfi_businesses', 'is_open'),
    ('morfi_businesses', 'accepts_delivery'),
    ('morfi_businesses', 'accepts_pickup'),
    ('morfi_businesses', 'delivery_fee'),
    ('morfi_businesses', 'delivery_fee_status'),
    ('morfi_businesses', 'transfer_alias'),
    ('morfi_orders', 'id'),
    ('morfi_orders', 'customer_id'),
    ('morfi_orders', 'business_id'),
    ('morfi_orders', 'request_key'),
    ('morfi_orders', 'request_fingerprint'),
    ('morfi_orders', 'checkout_fingerprint'),
    ('morfi_orders', 'order_number'),
    ('morfi_orders', 'customer_name_snapshot'),
    ('morfi_orders', 'customer_phone_snapshot'),
    ('morfi_orders', 'delivery_mode'),
    ('morfi_orders', 'delivery_address'),
    ('morfi_orders', 'delivery_references'),
    ('morfi_orders', 'customer_notes'),
    ('morfi_orders', 'payment_method'),
    ('morfi_orders', 'payment_status'),
    ('morfi_orders', 'subtotal'),
    ('morfi_orders', 'discount_total'),
    ('morfi_orders', 'delivery_fee'),
    ('morfi_orders', 'delivery_fee_status'),
    ('morfi_orders', 'total'),
    ('morfi_orders', 'status'),
    ('morfi_orders', 'status_reason'),
    ('morfi_orders', 'created_at'),
    ('morfi_orders', 'updated_at'),
    ('morfi_order_items', 'order_id'),
    ('morfi_order_items', 'business_id'),
    ('morfi_order_items', 'product_id'),
    ('morfi_order_items', 'recipe_id'),
    ('morfi_order_items', 'product_name'),
    ('morfi_order_items', 'quantity'),
    ('morfi_order_items', 'unit_price'),
    ('morfi_order_items', 'cash_discount_percent'),
    ('morfi_order_items', 'line_total'),
    ('morfi_order_items', 'customer_notes'),
    ('morfi_business_products', 'id'),
    ('morfi_business_products', 'business_id'),
    ('morfi_business_products', 'name'),
    ('morfi_business_products', 'is_available'),
    ('morfi_business_products', 'accepts_delivery'),
    ('morfi_business_products', 'payment_methods'),
    ('morfi_business_products', 'price'),
    ('morfi_business_products', 'cash_discount_percent'),
    ('morfi_business_products', 'recipe_id'),
    ('morfi_business_products', 'stock_quantity'),
    ('morfi_recipes', 'id'),
    ('morfi_recipes', 'business_id'),
    ('morfi_recipes', 'finished_stock'),
    ('morfi_recipes', 'yield_unit'),
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
    raise exception 'Required columns are missing: %', v_missing_columns;
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'morfi_orders_customer_snapshot'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'morfi_orders_updated_at'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'zz_morfi_orders_checkout_prepare_insert'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'zz_morfi_orders_checkout_prepare_update'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'morfi_orders_block_delivery_progress_without_quote'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'Required enabled order snapshot, updated_at, checkout, and delivery-protection triggers are missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_delivery_fee_status_valid'
      and convalidated
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_delivery_fee_status_valid'
      and convalidated
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_payment_status_valid'
      and convalidated
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_delivery_quote_payment_guard'
      and convalidated
  ) then
    raise exception 'Validated delivery-fee and payment-status constraints from the details migration are required';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.morfi_orders'::regclass
      and constraint_row.contype in ('u', 'p')
      and (
        select array_agg(attribute_row.attname order by key_column.ordinality)
        from unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
          and attribute_row.attnum = key_column.attnum
      ) = array['customer_id', 'request_key']::name[]
  ) then
    raise exception 'The unique customer/request-key constraint required for idempotency is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.morfi_order_items'::regclass
      and constraint_row.contype in ('u', 'p')
      and (
        select array_agg(attribute_row.attname order by key_column.ordinality)
        from unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
          and attribute_row.attnum = key_column.attnum
      ) = array['order_id', 'product_id']::name[]
  ) then
    raise exception 'The unique order/product constraint required for item persistence is missing';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.morfi_orders'::regclass
      and relrowsecurity
  ) or not exists (
    select 1
    from pg_class
    where oid = 'public.morfi_order_items'::regclass
      and relrowsecurity
  ) then
    raise exception 'RLS must be enabled on MORFI orders and order items before checkout RPCs are installed';
  end if;

  if not has_table_privilege('authenticated', 'public.morfi_orders', 'SELECT')
    or not has_table_privilege('authenticated', 'public.morfi_order_items', 'SELECT')
  then
    raise exception 'Authenticated participants need SELECT grants on orders and order items';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'morfi_orders'
      and policyname = 'orders_select_participant'
      and 'authenticated' = any(roles)
  ) or not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'morfi_order_items'
      and policyname = 'order_items_select_participant'
      and 'authenticated' = any(roles)
  ) then
    raise exception 'Participant read policies for orders and items are required';
  end if;
end
$$;

-- The original RPC remains available with its original signature. New clients
-- use this version for persisted checkout details and idempotency. The shared
-- snapshot trigger changes quote semantics only while this RPC sets its local
-- checkout_v2 marker; legacy RPC inserts and updates retain their old behavior.
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
  v_recipe_stock numeric(14, 4);
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

    if v_product.recipe_id is not null then
      select recipe.finished_stock
      into v_recipe_stock
      from public.morfi_recipes recipe
      where recipe.id = v_product.recipe_id
        and recipe.business_id = v_business.id
      for update;
      if not found or v_recipe_stock < v_item.quantity then
        raise exception 'Insufficient finished stock for product %', v_product.name;
      end if;

      update public.morfi_recipes
      set finished_stock = finished_stock - v_item.quantity,
          updated_at = now()
      where id = v_product.recipe_id
        and business_id = v_business.id
        and finished_stock >= v_item.quantity;
    else
      if v_product.stock_quantity < v_item.quantity then
        raise exception 'Insufficient finished stock for product %', v_product.name;
      end if;

      update public.morfi_business_products
      set stock_quantity = stock_quantity - v_item.quantity,
          updated_at = now()
      where id = v_product.id
        and business_id = v_business.id
        and stock_quantity >= v_item.quantity;
    end if;
    if not found then
      raise exception 'Finished stock changed while placing the order';
    end if;

    insert into public.morfi_inventory_movements (
      business_id, recipe_id, product_id, order_id, movement_type,
      quantity_delta, unit, reason, created_by
    )
    values (
      v_business.id,
      v_product.recipe_id,
      case when v_product.recipe_id is null then v_product.id end,
      v_order_id,
      'order_sale',
      -v_item.quantity,
      case when v_product.recipe_id is null then 'unidad' else (
        select recipe.yield_unit::text
        from public.morfi_recipes recipe
        where recipe.id = v_product.recipe_id
          and recipe.business_id = v_business.id
      ) end,
      'Venta registrada en pedido ' || left(v_order_id::text, 8),
      auth.uid()
    );

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

-- Preserve the older v2 RPC signature for clients that rely on profile phone.
create or replace function public.morfi_create_order_v2(
  p_business_id uuid,
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
  v_customer_phone text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select profile.phone
  into v_customer_phone
  from public.morfi_profiles profile
  where profile.id = auth.uid();
  if not found or nullif(btrim(v_customer_phone), '') is null then
    raise exception 'A valid customer phone number is required';
  end if;

  return query
  select created_order.order_id, created_order.order_number
  from public.morfi_create_order_v2(
    p_business_id,
    v_customer_phone,
    p_items,
    p_delivery_mode,
    p_delivery_address,
    p_delivery_references,
    p_payment_method,
    p_customer_notes,
    p_request_key
  ) as created_order;
end
$$;

-- Owner/manager records the agreed delivery amount, including an explicit free quote (0).
create or replace function public.morfi_set_order_delivery_fee(
  p_order_id uuid,
  p_delivery_fee numeric
)
returns table (order_number bigint, total numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.morfi_orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_order_id is null or p_delivery_fee is null or p_delivery_fee < 0 then
    raise exception 'Order and a non-negative delivery fee are required';
  end if;

  select *
  into v_order
  from public.morfi_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if not public.morfi_has_business_access(
    v_order.business_id,
    array['owner', 'manager']::public.morfi_workspace_role[]
  ) then
    raise exception 'Only this business owner or manager can set the delivery fee';
  end if;
  if v_order.delivery_mode = 'delivery'
    and v_order.delivery_fee_status in ('free', 'fixed')
    and v_order.delivery_fee = p_delivery_fee
  then
    return query
    select v_order.order_number, v_order.total;
    return;
  end if;
  if v_order.delivery_mode <> 'delivery'
    or v_order.delivery_fee_status <> 'pending'
    or v_order.status not in ('pending', 'accepted', 'preparing', 'ready')
  then
    raise exception 'This order does not have an active delivery quote pending';
  end if;

  update public.morfi_orders
  set delivery_fee_status = case when p_delivery_fee = 0 then 'free' else 'fixed' end,
      delivery_fee = p_delivery_fee,
      total = round(subtotal - discount_total + p_delivery_fee, 2),
      payment_status = case
        when payment_method = 'transfer' then 'pending_payment'
        else 'awaiting_collection'
      end,
      updated_at = now()
  where id = p_order_id;

  return query
  select order_record.order_number, order_record.total
  from public.morfi_orders order_record
  where order_record.id = p_order_id;
end
$$;

revoke all on function public.morfi_create_order_v2(
  uuid, text, jsonb, text, text, text, text, text, uuid
) from public, anon;
grant execute on function public.morfi_create_order_v2(
  uuid, text, jsonb, text, text, text, text, text, uuid
) to authenticated;
revoke all on function public.morfi_create_order_v2(
  uuid, jsonb, text, text, text, text, text, uuid
) from public, anon;
grant execute on function public.morfi_create_order_v2(
  uuid, jsonb, text, text, text, text, text, uuid
) to authenticated;

revoke all on function public.morfi_set_order_delivery_fee(uuid, numeric)
  from public, anon;
grant execute on function public.morfi_set_order_delivery_fee(uuid, numeric)
  to authenticated;

notify pgrst, 'reload schema';
commit;
