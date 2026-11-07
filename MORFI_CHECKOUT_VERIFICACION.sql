-- 2. Continuá con las consultas posteriores solo después de aplicar la migración. Consultas de solo lectura para el checkout MORFI.
-- Ejecutar las consultas 1-2 antes de migrar y guardar sus resultados.
-- Ejecutar las restantes después de aplicar MORFI_CHECKOUT_LISTO.sql.
-- No contiene cambios de esquema ni de datos.

-- 1. Baseline pre-migración. Guardá el resultado baseline_snapshot completo:
-- es una lista exacta de IDs y valores previos a migrar, no un corte temporal.
select
  count(*) as order_count,
  coalesce(sum(subtotal), 0) as subtotal_sum,
  coalesce(sum(discount_total), 0) as discount_sum,
  coalesce(sum(delivery_fee), 0) as delivery_fee_sum,
  coalesce(sum(total), 0) as total_sum,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'subtotal', subtotal,
      'discount_total', discount_total,
      'delivery_fee', delivery_fee,
      'total', total,
      'status', status::text,
      'payment_status', payment_status,
      'payment_method', payment_method,
      'delivery_mode', delivery_mode,
      'created_at', created_at
    )
    order by id
  ), '[]'::jsonb) as baseline_snapshot
from public.morfi_orders;

-- 2. Continuá con las consultas posteriores solo después de aplicar la migración.
-- 3. Columnas y tablas que debe dejar instaladas la migración.
select required.table_name, required.column_name,
  exists (
    select 1
    from information_schema.columns actual
    where actual.table_schema = 'public'
      and actual.table_name = required.table_name
      and actual.column_name = required.column_name
  ) as exists
from (values
  ('morfi_businesses', 'delivery_fee_status'),
  ('morfi_orders', 'order_number'),
  ('morfi_orders', 'checkout_fingerprint'),
  ('morfi_orders', 'delivery_fee_status'),
  ('morfi_orders', 'delivery_references'),
  ('morfi_orders', 'customer_notes'),
  ('morfi_orders', 'transfer_bank_snapshot'),
  ('morfi_orders', 'transfer_alias_snapshot'),
  ('morfi_orders', 'transfer_holder_snapshot'),
  ('morfi_order_items', 'customer_notes')
) as required(table_name, column_name)
order by required.table_name, required.column_name;

-- 4. Funciones requeridas. morfi_create_order debe seguir siendo la RPC antigua.
select required.signature,
  to_regprocedure(required.signature) is not null as exists
from (values
  ('public.morfi_create_order(uuid,jsonb,text,text,text,uuid)'),
  ('public.morfi_create_order_v2(uuid,text,jsonb,text,text,text,text,text,uuid)'),
  ('public.morfi_create_order_v2(uuid,jsonb,text,text,text,text,text,uuid)'),
  ('public.morfi_review_transfer_payment(uuid,text,boolean)'),
  ('public.morfi_update_order_status_with_reason(uuid,public.morfi_order_status,text)'),
  ('public.morfi_public_business_transfer_alias(uuid)'),
  ('public.morfi_public_business_contact(uuid)'),
  ('public.morfi_set_order_delivery_fee(uuid,numeric)')
) as required(signature)
order by required.signature;

-- 5. RLS y políticas participantes para lectura de pedidos.
select relation.relname as table_name,
  relation.relrowsecurity as rls_enabled,
  exists (
    select 1 from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = relation.relname
      and policy.cmd = 'SELECT'
      and 'authenticated' = any(policy.roles)
  ) as authenticated_select_policy
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in ('morfi_orders', 'morfi_order_items')
order by relation.relname;

-- 6. Seguridad y permisos efectivos en las nuevas RPC.
select procedure.oid::regprocedure::text as function_signature,
  procedure.prosecdef as security_definer,
  has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_can_execute,
  exists (
    select 1
    from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) as public_can_execute
from pg_proc procedure
join pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.oid in (
    to_regprocedure('public.morfi_create_order(uuid,jsonb,text,text,text,uuid)'),
    to_regprocedure('public.morfi_create_order_v2(uuid,text,jsonb,text,text,text,text,text,uuid)'),
    to_regprocedure('public.morfi_create_order_v2(uuid,jsonb,text,text,text,text,text,uuid)'),
    to_regprocedure('public.morfi_review_transfer_payment(uuid,text,boolean)'),
    to_regprocedure('public.morfi_update_order_status_with_reason(uuid,public.morfi_order_status,text)'),
    to_regprocedure('public.morfi_public_business_transfer_alias(uuid)'),
    to_regprocedure('public.morfi_public_business_contact(uuid)'),
    to_regprocedure('public.morfi_set_order_delivery_fee(uuid,numeric)')
  )
order by function_signature;

-- 7. Triggers compartidos que deben estar habilitados.
select relation.relname as table_name, trigger.tgname,
  trigger.tgenabled,
  pg_get_triggerdef(trigger.oid) as definition
from pg_trigger trigger
join pg_class relation on relation.oid = trigger.tgrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in ('morfi_orders', 'morfi_businesses')
  and not trigger.tgisinternal
  and trigger.tgname in (
    'morfi_orders_customer_snapshot',
    'morfi_orders_updated_at',
    'zz_morfi_orders_checkout_prepare_insert',
    'zz_morfi_orders_checkout_prepare_update',
    'morfi_orders_block_delivery_progress_without_quote'
  )
order by relation.relname, trigger.tgname;

-- 8. El alias solo debe estar disponible mediante la RPC pública autorizada.
select
  has_column_privilege('anon', 'public.morfi_businesses', 'bank_name', 'SELECT')
    as anon_can_read_bank_name,
  has_column_privilege('authenticated', 'public.morfi_businesses', 'bank_name', 'SELECT')
    as authenticated_can_read_bank_name,
  has_column_privilege('anon', 'public.morfi_businesses', 'bank_cuit', 'SELECT')
    as anon_can_read_bank_cuit,
  has_column_privilege('authenticated', 'public.morfi_businesses', 'bank_cuit', 'SELECT')
    as authenticated_can_read_bank_cuit,
  has_column_privilege('anon', 'public.morfi_businesses', 'transfer_alias', 'SELECT')
    as anon_can_read_transfer_alias,
  has_column_privilege('authenticated', 'public.morfi_businesses', 'transfer_alias', 'SELECT')
    as authenticated_can_read_transfer_alias,
  has_column_privilege('anon', 'public.morfi_businesses', 'transfer_holder', 'SELECT')
    as anon_can_read_transfer_holder,
  has_column_privilege('authenticated', 'public.morfi_businesses', 'transfer_holder', 'SELECT')
    as authenticated_can_read_transfer_holder;

-- 9. Restricciones relacionadas con cotización y estados de pago.
select constraint_row.conrelid::regclass::text as table_name,
  constraint_row.conname,
  constraint_row.convalidated,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
where constraint_row.conrelid in (
  'public.morfi_orders'::regclass,
  'public.morfi_businesses'::regclass
)
  and constraint_row.conname in (
    'morfi_businesses_delivery_fee_status_valid',
    'morfi_orders_delivery_fee_status_valid',
    'morfi_orders_payment_status_valid',
    'morfi_orders_delivery_quote_payment_guard',
    'morfi_orders_checkout_fingerprint_length'
  )
order by table_name, constraint_row.conname;

-- 10. Idempotencia: unicidad por cliente/clave y ausencia de claves duplicadas.
select constraint_row.conname, pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
where constraint_row.conrelid = 'public.morfi_orders'::regclass
  and constraint_row.contype in ('p', 'u')
order by constraint_row.conname;

select customer_id, request_key, count(*) as matching_orders
from public.morfi_orders
group by customer_id, request_key
having count(*) > 1;

-- 11. No debe existir pago verificado ni entrega iniciada con delivery sin cotizar.
select id, order_number, payment_method, payment_status, delivery_mode,
  delivery_fee_status, status
from public.morfi_orders
where delivery_fee_status = 'pending'
  and (
    payment_status = 'verified'
    or status in ('on_the_way', 'delivered')
  );

-- 12. No debe haber movimientos de venta repetidos por producto en un pedido v2.
select movement.order_id, movement.product_id, movement.recipe_id,
  count(*) as sale_movements
from public.morfi_inventory_movements movement
join public.morfi_orders order_record on order_record.id = movement.order_id
where movement.movement_type = 'order_sale'
  and order_record.checkout_fingerprint is not null
group by movement.order_id, movement.product_id, movement.recipe_id
having count(*) > 1;

-- 13. Comparación exacta posterior. Reemplazá el texto indicado por el JSON
-- baseline_snapshot de la consulta 1. Los pedidos nuevos se excluyen por ID,
-- aunque se hayan creado antes de ejecutar esta consulta.
with baseline as (
  select *
  from jsonb_to_recordset(
    'PEGAR_AQUI_EL_VALOR_COMPLETO_DE_baseline_snapshot'::jsonb
  ) as snapshot(
    id uuid,
    subtotal numeric,
    discount_total numeric,
    delivery_fee numeric,
    total numeric,
    status text,
    payment_status text,
    payment_method text,
    delivery_mode text,
    created_at timestamptz
  )
), comparison as (
  select
    baseline.*,
    current_order.id as current_id,
    current_order.subtotal as current_subtotal,
    current_order.discount_total as current_discount_total,
    current_order.delivery_fee as current_delivery_fee,
    current_order.total as current_total,
    current_order.status::text as current_status,
    current_order.payment_status as current_payment_status,
    current_order.payment_method as current_payment_method,
    current_order.delivery_mode as current_delivery_mode,
    current_order.created_at as current_created_at
  from baseline
  left join public.morfi_orders current_order on current_order.id = baseline.id
)
select
  count(*) as baseline_order_count,
  count(current_id) as found_historical_order_count,
  count(*) filter (where current_id is null) as missing_historical_order_count,
  count(*) filter (
    where current_id is not null
      and (
        current_subtotal is distinct from subtotal
        or current_discount_total is distinct from discount_total
        or current_delivery_fee is distinct from delivery_fee
        or current_total is distinct from total
        or current_status is distinct from status
        or current_payment_status is distinct from payment_status
        or current_payment_method is distinct from payment_method
        or current_delivery_mode is distinct from delivery_mode
        or current_created_at is distinct from created_at
      )
  ) as changed_historical_order_count,
  coalesce(sum(subtotal), 0) as baseline_subtotal_sum,
  coalesce(sum(discount_total), 0) as baseline_discount_sum,
  coalesce(sum(delivery_fee), 0) as baseline_delivery_fee_sum,
  coalesce(sum(total), 0) as baseline_total_sum,
  coalesce(sum(current_subtotal), 0) as current_subtotal_sum,
  coalesce(sum(current_discount_total), 0) as current_discount_sum,
  coalesce(sum(current_delivery_fee), 0) as current_delivery_fee_sum,
  coalesce(sum(current_total), 0) as current_total_sum
from comparison;
