-- MORFI: reparacion incremental para el esquema existente.
-- Revisar antes de ejecutar en un proyecto de desarrollo. No aplicar el esquema inicial.
-- Este archivo no cambia contrasenas, usuarios existentes ni elimina tablas o filas.

begin;

-- Fallar antes de modificar objetos si la base no corresponde al esquema esperado.
do $$
begin
  if to_regclass('public.morfi_profiles') is null
    or to_regclass('public.morfi_businesses') is null
    or to_regclass('public.morfi_business_memberships') is null
    or to_regclass('public.morfi_business_products') is null
    or to_regclass('public.morfi_orders') is null
    or to_regclass('public.morfi_order_items') is null
  then
    raise exception 'MORFI repair stopped: one or more required MORFI tables are missing';
  end if;

  if to_regprocedure('public.morfi_has_business_access(uuid,public.morfi_workspace_role[])') is null
    or to_regprocedure('public.morfi_update_order_status(uuid,public.morfi_order_status)') is null
  then
    raise exception 'MORFI repair stopped: expected access-control or order-transition function is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'morfi_auth_user_profile'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'MORFI repair stopped: morfi_auth_user_profile must create profiles before business signup';
  end if;
end
$$;

-- Campos que usa el catalogo publico de emprendimientos y la registracion.
alter table public.morfi_businesses
  add column if not exists bank_cuit text,
  add column if not exists bank_name text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

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
          or (latitude between -90 and 90 and longitude between -180 and 180)
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

-- Datos de pedidos que leen orderService.ts y las pantallas de seguimiento.
-- Los pedidos previos conservan snapshots nulos y payment_status not_applicable:
-- no se reconstruyen datos personales ni estados de pago que no fueron registrados.
alter table public.morfi_orders
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists payment_status text not null default 'not_applicable',
  add column if not exists status_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
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

revoke all on function public.morfi_snapshot_order_customer()
  from public, anon, authenticated;

drop trigger if exists morfi_orders_customer_snapshot on public.morfi_orders;
create trigger morfi_orders_customer_snapshot
before insert on public.morfi_orders
for each row execute function public.morfi_snapshot_order_customer();

-- Se registra el estado actual al reparar; no se inventa el historial previo.
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
select
  order_record.id,
  order_record.status,
  null,
  nullif(btrim(order_record.status_reason), ''),
  now()
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
  if tg_op = 'INSERT' then
    insert into public.morfi_order_status_history (
      order_id, status, changed_by, reason
    )
    values (
      new.id, new.status, auth.uid(), nullif(btrim(new.status_reason), '')
    );
  elsif new.status is distinct from old.status then
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

revoke all on function public.morfi_record_order_status_history()
  from public, anon, authenticated;

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

  -- Mantiene las transiciones y la restitucion de stock de la funcion existente.
  perform public.morfi_update_order_status(p_order_id, p_new_status);
end
$$;

revoke all on function public.morfi_update_order_status_with_reason(
  uuid, public.morfi_order_status, text
) from public, anon;
grant execute on function public.morfi_update_order_status_with_reason(
  uuid, public.morfi_order_status, text
) to authenticated;

-- Reviews: las claves compuestas garantizan que orden, emprendimiento y producto
-- correspondan entre si; el trigger valida que el pedido se haya entregado.
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

revoke all on function public.morfi_validate_review()
  from public, anon, authenticated;

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
grant insert (order_id, rating, comment)
  on public.morfi_business_reviews to authenticated;
grant insert (order_id, product_id, rating, comment)
  on public.morfi_product_reviews to authenticated;
grant select (business_id, rating, comment, created_at)
  on public.morfi_business_reviews to anon;
grant select (product_id, rating, comment, created_at)
  on public.morfi_product_reviews to anon;
grant select (order_id, business_id, rating, comment, created_at)
  on public.morfi_business_reviews to authenticated;
grant select (order_id, product_id, business_id, rating, comment, created_at)
  on public.morfi_product_reviews to authenticated;

drop policy if exists morfi_order_status_history_participants
  on public.morfi_order_status_history;
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

drop policy if exists morfi_business_reviews_public_read
  on public.morfi_business_reviews;
create policy morfi_business_reviews_public_read
on public.morfi_business_reviews for select to anon, authenticated
using (true);

drop policy if exists morfi_business_reviews_customer_insert
  on public.morfi_business_reviews;
create policy morfi_business_reviews_customer_insert
on public.morfi_business_reviews for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and exists (
    select 1
    from public.morfi_orders order_record
    where order_record.id = order_id
      and order_record.customer_id = (select auth.uid())
      and order_record.status = 'delivered'
  )
);

drop policy if exists morfi_product_reviews_public_read
  on public.morfi_product_reviews;
create policy morfi_product_reviews_public_read
on public.morfi_product_reviews for select to anon, authenticated
using (true);

drop policy if exists morfi_product_reviews_customer_insert
  on public.morfi_product_reviews;
create policy morfi_product_reviews_customer_insert
on public.morfi_product_reviews for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and exists (
    select 1
    from public.morfi_order_items item
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
select
  business_id,
  count(*)::integer as review_count,
  round(avg(rating)::numeric, 2) as average_rating
from public.morfi_business_reviews
group by business_id;

create or replace view public.morfi_product_review_summary
with (security_invoker = true, security_barrier = true)
as
select
  product_id,
  count(*)::integer as review_count,
  round(avg(rating)::numeric, 2) as average_rating
from public.morfi_product_reviews
group by product_id;

grant select on public.morfi_business_review_summary,
  public.morfi_product_review_summary to anon, authenticated;

-- Un negocio nuevo siempre recibe su membresia owner, incluso si se crea desde
-- el trigger de registro en auth.users.
create or replace function public.morfi_create_business_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.morfi_business_memberships (business_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end
$$;

revoke all on function public.morfi_create_business_owner_membership()
  from public, anon, authenticated;

drop trigger if exists morfi_business_owner_membership on public.morfi_businesses;
create trigger morfi_business_owner_membership
after insert on public.morfi_businesses
for each row execute function public.morfi_create_business_owner_membership();

-- Los triggers de auth.users se ejecutan dentro de la transaccion que crea el
-- usuario, aun si Supabase requiere confirmar el email antes de emitir sesion.
-- El trigger de perfil morfi_auth_user_profile se ejecuta primero por nombre.
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

drop trigger if exists morfi_auth_user_profile_business on auth.users;
create trigger morfi_auth_user_profile_business
after insert on auth.users
for each row execute function public.morfi_create_business_from_signup();

-- No se reemplaza morfi_public_market_catalog: pertenece al mercado de proveedores.
-- Hungry consulta los emprendimientos en morfi_businesses/morfi_business_products y
-- los productos de mercado en esa vista independiente.

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
