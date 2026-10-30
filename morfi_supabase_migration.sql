-- MORFI initial schema for Supabase.
-- Review this file before running it in the Supabase SQL Editor.
-- It is intentionally not applied by the application or build process.
-- Catalog photos are public assets. Never store private documents in this bucket.

begin;

do $$
begin
  create type public.morfi_measure_unit as enum ('g', 'kg', 'ml', 'l', 'unidad');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.morfi_yield_unit as enum ('unidades', 'porciones');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.morfi_order_status as enum (
    'pending',
    'accepted',
    'preparing',
    'ready',
    'on_the_way',
    'delivered',
    'rejected',
    'cancellation_requested',
    'cancelled'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.morfi_workspace_role as enum ('owner', 'manager', 'staff');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.morfi_inventory_movement_type as enum (
    'manual_adjustment',
    'purchase',
    'production_consumption',
    'production_output',
    'order_sale',
    'manual_sale',
    'order_return'
  );
exception
  when duplicate_object then null;
end
$$;

create table public.morfi_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  email text,
  dni text,
  enabled_panels text[] not null default array[]::text[]
    check (enabled_panels <@ array['cliente', 'emprendimiento', 'ahorro']::text[]),
  seller_alias text,
  seller_holder text,
  seller_location text,
  seller_directions text,
  seller_logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (dni is null or dni ~ '^[0-9]{7,10}$')
);

create unique index morfi_profiles_dni_unique
on public.morfi_profiles (dni)
where dni is not null;

create or replace function public.morfi_sync_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.morfi_profiles (
      id, full_name, phone, email, dni, enabled_panels,
      seller_alias, seller_holder, seller_location, seller_directions
    )
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'phone', ''),
      new.email,
      nullif(new.raw_user_meta_data ->> 'dni', ''),
      case
        when jsonb_typeof(new.raw_user_meta_data -> 'enabled_panels') = 'array'
          then array(
            select panel
            from jsonb_array_elements_text(new.raw_user_meta_data -> 'enabled_panels') as panels(panel)
            where panel = any(array['cliente', 'emprendimiento', 'ahorro']::text[])
          )
        else array[]::text[]
      end,
      nullif(new.raw_user_meta_data ->> 'seller_alias', ''),
      nullif(new.raw_user_meta_data ->> 'seller_holder', ''),
      nullif(new.raw_user_meta_data ->> 'seller_location', ''),
      nullif(new.raw_user_meta_data ->> 'seller_directions', '')
    )
    on conflict (id) do nothing;
  else
    update public.morfi_profiles
    set email = new.email,
        full_name = coalesce(new.raw_user_meta_data ->> 'full_name', ''),
        phone = nullif(new.raw_user_meta_data ->> 'phone', ''),
        dni = nullif(new.raw_user_meta_data ->> 'dni', ''),
        enabled_panels = case
          when jsonb_typeof(new.raw_user_meta_data -> 'enabled_panels') = 'array'
            then array(
              select panel
              from jsonb_array_elements_text(new.raw_user_meta_data -> 'enabled_panels') as panels(panel)
              where panel = any(array['cliente', 'emprendimiento', 'ahorro']::text[])
            )
          else array[]::text[]
        end,
        seller_alias = nullif(new.raw_user_meta_data ->> 'seller_alias', ''),
        seller_holder = nullif(new.raw_user_meta_data ->> 'seller_holder', ''),
        seller_location = nullif(new.raw_user_meta_data ->> 'seller_location', ''),
        seller_directions = nullif(new.raw_user_meta_data ->> 'seller_directions', ''),
        updated_at = now()
    where id = new.id;
  end if;

  return new;
end
$$;

revoke all on function public.morfi_sync_auth_profile() from public, anon, authenticated;

create trigger morfi_auth_user_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.morfi_sync_auth_profile();

create or replace function public.morfi_protect_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.email is distinct from old.email
  then
    raise exception 'Profile identity and email are managed by authentication';
  end if;

  new.updated_at := now();
  return new;
end
$$;

create trigger morfi_profile_identity_guard
before update on public.morfi_profiles
for each row execute function public.morfi_protect_profile_identity();

create or replace function public.morfi_protect_workspace_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Workspace creator cannot be changed';
  end if;
  return new;
end
$$;

-- A user may belong to many businesses and suppliers; contact details stay private.
create table public.morfi_businesses (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.morfi_profiles(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  logo_path text,
  contact_phone text,
  contact_email text,
  transfer_alias text check (transfer_alias is null or length(transfer_alias) <= 120),
  transfer_holder text check (transfer_holder is null or length(transfer_holder) <= 120),
  location text check (location is null or length(location) <= 180),
  directions text check (directions is null or length(directions) <= 300),
  phone_is_public boolean not null default false,
  email_is_public boolean not null default false,
  accepts_delivery boolean not null default false,
  accepts_pickup boolean not null default true,
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  payment_methods text[] not null default array['cash']::text[]
    check (
      cardinality(payment_methods) > 0
      and payment_methods <@ array['cash', 'transfer']::text[]
    ),
  is_open boolean not null default false,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (accepts_delivery or accepts_pickup)
);

create table public.morfi_business_memberships (
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  user_id uuid not null references public.morfi_profiles(id) on delete cascade,
  role public.morfi_workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create unique index morfi_business_one_owner
on public.morfi_business_memberships (business_id)
where role = 'owner';

create table public.morfi_suppliers (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.morfi_profiles(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  logo_path text,
  zone text not null default '' check (length(zone) <= 120),
  contact_phone text,
  contact_email text,
  phone_is_public boolean not null default false,
  email_is_public boolean not null default false,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.morfi_supplier_memberships (
  supplier_id uuid not null references public.morfi_suppliers(id) on delete cascade,
  user_id uuid not null references public.morfi_profiles(id) on delete cascade,
  role public.morfi_workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (supplier_id, user_id)
);

create unique index morfi_supplier_one_owner
on public.morfi_supplier_memberships (supplier_id)
where role = 'owner';

create or replace function public.morfi_has_business_access(
  p_business_id uuid,
  p_roles public.morfi_workspace_role[] default array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.morfi_business_memberships membership
    where membership.business_id = p_business_id
      and membership.user_id = auth.uid()
      and membership.role = any(p_roles)
  )
$$;

create or replace function public.morfi_has_supplier_access(
  p_supplier_id uuid,
  p_roles public.morfi_workspace_role[] default array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.morfi_supplier_memberships membership
    where membership.supplier_id = p_supplier_id
      and membership.user_id = auth.uid()
      and membership.role = any(p_roles)
  )
$$;

create or replace function public.morfi_add_business_member(
  p_business_id uuid,
  p_user_id uuid,
  p_role public.morfi_workspace_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.morfi_has_business_access(
      p_business_id,
      array['owner']::public.morfi_workspace_role[]
    )
  then
    raise exception 'Only this business owner can manage its members';
  end if;
  if p_user_id is null
    or p_role not in ('manager', 'staff')
    or not exists (select 1 from public.morfi_profiles where id = p_user_id)
  then
    raise exception 'A valid user and non-owner role are required';
  end if;

  insert into public.morfi_business_memberships (business_id, user_id, role)
  values (p_business_id, p_user_id, p_role)
  on conflict (business_id, user_id) do update
    set role = excluded.role
    where public.morfi_business_memberships.role <> 'owner';

  if not found then
    raise exception 'The owner role cannot be changed';
  end if;
end
$$;

create or replace function public.morfi_remove_business_member(
  p_business_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.morfi_has_business_access(
      p_business_id,
      array['owner']::public.morfi_workspace_role[]
    )
  then
    raise exception 'Only this business owner can manage its members';
  end if;

  delete from public.morfi_business_memberships
  where business_id = p_business_id
    and user_id = p_user_id
    and role <> 'owner';
  if not found then
    raise exception 'Member not found or the owner cannot be removed';
  end if;
end
$$;

create or replace function public.morfi_add_supplier_member(
  p_supplier_id uuid,
  p_user_id uuid,
  p_role public.morfi_workspace_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.morfi_has_supplier_access(
      p_supplier_id,
      array['owner']::public.morfi_workspace_role[]
    )
  then
    raise exception 'Only this supplier owner can manage its members';
  end if;
  if p_user_id is null
    or p_role not in ('manager', 'staff')
    or not exists (select 1 from public.morfi_profiles where id = p_user_id)
  then
    raise exception 'A valid user and non-owner role are required';
  end if;

  insert into public.morfi_supplier_memberships (supplier_id, user_id, role)
  values (p_supplier_id, p_user_id, p_role)
  on conflict (supplier_id, user_id) do update
    set role = excluded.role
    where public.morfi_supplier_memberships.role <> 'owner';

  if not found then
    raise exception 'The owner role cannot be changed';
  end if;
end
$$;

create or replace function public.morfi_remove_supplier_member(
  p_supplier_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.morfi_has_supplier_access(
      p_supplier_id,
      array['owner']::public.morfi_workspace_role[]
    )
  then
    raise exception 'Only this supplier owner can manage its members';
  end if;

  delete from public.morfi_supplier_memberships
  where supplier_id = p_supplier_id
    and user_id = p_user_id
    and role <> 'owner';
  if not found then
    raise exception 'Member not found or the owner cannot be removed';
  end if;
end
$$;

create or replace function public.morfi_create_workspace_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'morfi_businesses' then
    insert into public.morfi_business_memberships (business_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  else
    insert into public.morfi_supplier_memberships (supplier_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  end if;
  return new;
end
$$;

revoke all on function public.morfi_create_workspace_owner_membership() from public, anon, authenticated;

create trigger morfi_business_owner_membership
after insert on public.morfi_businesses
for each row execute function public.morfi_create_workspace_owner_membership();

create trigger morfi_supplier_owner_membership
after insert on public.morfi_suppliers
for each row execute function public.morfi_create_workspace_owner_membership();

create table public.morfi_business_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  image_path text,
  price numeric(12, 2) not null check (price > 0),
  -- Used for products without a linked recipe; recipe.finished_stock is canonical otherwise.
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_available boolean not null default true,
  accepts_delivery boolean not null default false,
  payment_methods text[] not null default array['cash']::text[]
    check (
      cardinality(payment_methods) > 0
      and payment_methods <@ array['cash', 'transfer']::text[]
    ),
  cash_discount_percent numeric(5, 2)
    check (cash_discount_percent is null or cash_discount_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);

create table public.morfi_supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.morfi_suppliers(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  category text not null default '' check (length(category) <= 100),
  comparison_key text not null default '' check (length(comparison_key) <= 160),
  sale_unit text not null default 'unidad' check (length(btrim(sale_unit)) between 1 and 40),
  image_path text,
  price numeric(12, 2) not null check (price > 0),
  is_available boolean not null default true,
  accepts_delivery boolean not null default false,
  payment_methods text[] not null default array['cash']::text[]
    check (
      cardinality(payment_methods) > 0
      and payment_methods <@ array['cash', 'transfer']::text[]
    ),
  cash_discount_percent numeric(5, 2)
    check (cash_discount_percent is null or cash_discount_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, supplier_id)
);

create table public.morfi_supplier_promotions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.morfi_suppliers(id) on delete cascade,
  supplier_product_id uuid,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 500),
  discount_type text not null check (discount_type in ('percent', 'fixed_price')),
  discount_value numeric(12, 2) not null check (discount_value > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (discount_type <> 'percent' or discount_value <= 100),
  foreign key (supplier_product_id, supplier_id)
    references public.morfi_supplier_products(id, supplier_id) on delete cascade
);

create index morfi_supplier_promotions_active
on public.morfi_supplier_promotions (supplier_id, starts_at, ends_at)
where is_active;

create table public.morfi_basket_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.morfi_profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.morfi_basket_items (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null,
  user_id uuid not null references public.morfi_profiles(id) on delete cascade,
  item_name text not null check (length(btrim(item_name)) between 1 and 160),
  comparison_key text not null check (length(btrim(comparison_key)) between 1 and 160),
  category text not null default '' check (length(category) <= 100),
  quantity numeric(14, 4) not null default 1 check (quantity > 0),
  unit text not null default 'unidad' check (length(btrim(unit)) between 1 and 40),
  created_at timestamptz not null default now(),
  foreign key (basket_id, user_id)
    references public.morfi_basket_lists(id, user_id) on delete cascade
);

create index morfi_basket_items_owner
on public.morfi_basket_items (user_id, basket_id);

create table public.morfi_ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  purchase_quantity numeric(14, 4) not null check (purchase_quantity > 0),
  purchase_unit public.morfi_measure_unit not null,
  purchase_price numeric(12, 2) not null check (purchase_price >= 0),
  stock_quantity numeric(14, 4) not null default 0 check (stock_quantity >= 0),
  stock_unit public.morfi_measure_unit not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (purchase_unit in ('g', 'kg') and stock_unit in ('g', 'kg'))
    or (purchase_unit in ('ml', 'l') and stock_unit in ('ml', 'l'))
    or (purchase_unit = 'unidad' and stock_unit = 'unidad')
  ),
  unique (id, business_id)
);

create table public.morfi_recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  yield_quantity numeric(12, 4) not null check (yield_quantity > 0),
  yield_unit public.morfi_yield_unit not null,
  additional_costs numeric(12, 2) not null default 0 check (additional_costs >= 0),
  selling_price numeric(12, 2) check (selling_price is null or selling_price >= 0),
  finished_stock numeric(14, 4) not null default 0 check (finished_stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (yield_unit <> 'unidades' or yield_quantity = trunc(yield_quantity)),
  unique (id, business_id)
);

alter table public.morfi_business_products
  add column recipe_id uuid,
  add constraint morfi_business_product_recipe_fk
    foreign key (recipe_id, business_id)
    references public.morfi_recipes(id, business_id) on delete restrict,
  add constraint morfi_business_product_recipe_unique unique (recipe_id),
  add constraint morfi_recipe_stock_source_check
    check (recipe_id is null or stock_quantity = 0);

create table public.morfi_recipe_ingredients (
  recipe_id uuid not null,
  ingredient_id uuid not null,
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit public.morfi_measure_unit not null,
  primary key (recipe_id, ingredient_id),
  foreign key (recipe_id, business_id)
    references public.morfi_recipes(id, business_id) on delete cascade,
  foreign key (ingredient_id, business_id)
    references public.morfi_ingredients(id, business_id) on delete restrict
);

create or replace function public.morfi_validate_recipe_ingredient()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_purchase_unit public.morfi_measure_unit;
begin
  select purchase_unit
  into v_purchase_unit
  from public.morfi_ingredients
  where id = new.ingredient_id and business_id = new.business_id;

  if not found then
    raise exception 'Ingredient not found for this business';
  end if;
  if not (
    (new.unit in ('g', 'kg') and v_purchase_unit in ('g', 'kg'))
    or (new.unit in ('ml', 'l') and v_purchase_unit in ('ml', 'l'))
    or (new.unit = 'unidad' and v_purchase_unit = 'unidad')
  ) then
    raise exception 'Recipe and purchase ingredient units are incompatible';
  end if;

  return new;
end
$$;

create or replace function public.morfi_lock_recipe_ingredient_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recipe_id uuid;
begin
  if tg_op = 'UPDATE' and old.recipe_id is distinct from new.recipe_id then
    for v_recipe_id in
      select recipe_id
      from unnest(array[old.recipe_id, new.recipe_id]) as recipes(recipe_id)
      order by recipe_id
    loop
      perform 1 from public.morfi_recipes where id = v_recipe_id for update;
    end loop;
  else
    v_recipe_id := case when tg_op = 'DELETE' then old.recipe_id else new.recipe_id end;
    perform 1 from public.morfi_recipes where id = v_recipe_id for update;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger morfi_recipe_ingredient_parent_lock
before insert or update or delete on public.morfi_recipe_ingredients
for each row execute function public.morfi_lock_recipe_ingredient_parent();

create trigger morfi_recipe_ingredient_unit_guard
before insert or update on public.morfi_recipe_ingredients
for each row execute function public.morfi_validate_recipe_ingredient();

create or replace function public.morfi_unit_factor(p_unit public.morfi_measure_unit)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select case p_unit
    when 'kg' then 1000::numeric
    when 'l' then 1000::numeric
    else 1::numeric
  end
$$;

create table public.morfi_production_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  recipe_id uuid not null,
  recipe_name text not null,
  recipe_name text not null,
  quantity numeric(14, 4) not null check (quantity > 0),
  yield_unit public.morfi_yield_unit not null,
  total_cost numeric(12, 2) not null check (total_cost >= 0),
  cost_per_unit numeric(12, 4) not null check (cost_per_unit >= 0),
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (recipe_id, business_id)
    references public.morfi_recipes(id, business_id) on delete restrict
);

create table public.morfi_production_batch_items (
  batch_id uuid not null,
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  ingredient_id uuid not null,
  ingredient_name text not null,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit public.morfi_measure_unit not null,
  line_cost numeric(12, 4) not null check (line_cost >= 0),
  primary key (batch_id, ingredient_id),
  foreign key (batch_id, business_id)
    references public.morfi_production_batches(id, business_id) on delete cascade,
  foreign key (ingredient_id, business_id)
    references public.morfi_ingredients(id, business_id) on delete restrict
);

create or replace function public.morfi_record_production(
  p_recipe_id uuid,
  p_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe public.morfi_recipes%rowtype;
  v_line record;
  v_ingredient public.morfi_ingredients%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_required numeric;
  v_line_cost numeric;
  v_ingredient_cost numeric := 0;
  v_total_cost numeric;
  v_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Production quantity must be greater than zero';
  end if;

  select *
  into v_recipe
  from public.morfi_recipes
  where id = p_recipe_id
    and public.morfi_has_business_access(
      business_id,
      array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
    )
  for update;
  if not found then
    raise exception 'Recipe not found or not accessible to the current user';
  end if;
  if v_recipe.yield_unit = 'unidades' and p_quantity <> trunc(p_quantity) then
    raise exception 'Unit-based production quantity must be a whole number';
  end if;

  for v_line in
    select ri.ingredient_id, ri.quantity, ri.unit
    from public.morfi_recipe_ingredients ri
    where ri.recipe_id = v_recipe.id and ri.business_id = v_recipe.business_id
    order by ri.ingredient_id
  loop
    select *
    into v_ingredient
    from public.morfi_ingredients
    where id = v_line.ingredient_id and business_id = v_recipe.business_id
    for update;
    if not found then
      raise exception 'Recipe ingredient is unavailable';
    end if;

    if not (
      (v_line.unit in ('g', 'kg') and v_ingredient.stock_unit in ('g', 'kg'))
      or (v_line.unit in ('ml', 'l') and v_ingredient.stock_unit in ('ml', 'l'))
      or (v_line.unit = 'unidad' and v_ingredient.stock_unit = 'unidad')
    ) or not (
      (v_line.unit in ('g', 'kg') and v_ingredient.purchase_unit in ('g', 'kg'))
      or (v_line.unit in ('ml', 'l') and v_ingredient.purchase_unit in ('ml', 'l'))
      or (v_line.unit = 'unidad' and v_ingredient.purchase_unit = 'unidad')
    ) then
      raise exception 'Recipe ingredient units are incompatible';
    end if;

    v_required := (
      v_line.quantity
      * public.morfi_unit_factor(v_line.unit)
      * p_quantity
      / v_recipe.yield_quantity
      / public.morfi_unit_factor(v_ingredient.stock_unit)
    );
    if v_ingredient.stock_quantity < v_required then
      raise exception 'Insufficient stock for ingredient %', v_ingredient.name;
    end if;

    v_line_cost := (
      v_line.quantity
      * public.morfi_unit_factor(v_line.unit)
      * v_ingredient.purchase_price
      / (v_ingredient.purchase_quantity * public.morfi_unit_factor(v_ingredient.purchase_unit))
      * p_quantity
      / v_recipe.yield_quantity
    );
    v_ingredient_cost := v_ingredient_cost + v_line_cost;
    update public.morfi_ingredients
    set stock_quantity = stock_quantity - v_required,
        updated_at = now()
    where id = v_ingredient.id and business_id = v_recipe.business_id;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ingredient_id', v_ingredient.id,
      'ingredient_name', v_ingredient.name,
      'quantity', v_required,
      'unit', v_ingredient.stock_unit::text,
      'line_cost', v_line_cost
    ));
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'A recipe must have at least one ingredient before production';
  end if;

  v_total_cost := round(
    v_ingredient_cost + v_recipe.additional_costs * p_quantity / v_recipe.yield_quantity,
    2
  );

  insert into public.morfi_production_batches (
    id, business_id, recipe_id, recipe_name, quantity, yield_unit, total_cost, cost_per_unit
  )
  values (
    v_batch_id,
    v_recipe.business_id,
    v_recipe.id,
    v_recipe.name,
    p_quantity,
    v_recipe.yield_unit,
    v_total_cost,
    v_total_cost / p_quantity
  );

  insert into public.morfi_production_batch_items (
    batch_id, business_id, ingredient_id, ingredient_name, quantity, unit, line_cost
  )
  select
    v_batch_id,
    v_recipe.business_id,
    (item ->> 'ingredient_id')::uuid,
    item ->> 'ingredient_name',
    (item ->> 'quantity')::numeric,
    (item ->> 'unit')::public.morfi_measure_unit,
    (item ->> 'line_cost')::numeric
  from jsonb_array_elements(v_items) as items(item);

  update public.morfi_recipes
  set finished_stock = finished_stock + p_quantity,
      updated_at = now()
  where id = v_recipe.id and business_id = v_recipe.business_id;

  insert into public.morfi_inventory_movements (
    business_id, ingredient_id, production_batch_id, movement_type,
    quantity_delta, unit, reason, created_by
  )
  select
    item.business_id,
    item.ingredient_id,
    v_batch_id,
    'production_consumption',
    -item.quantity,
    item.unit::text,
    'Consumo registrado en producción ' || left(v_batch_id::text, 8),
    auth.uid()
  from public.morfi_production_batch_items item
  where item.batch_id = v_batch_id
    and item.business_id = v_recipe.business_id;

  insert into public.morfi_inventory_movements (
    business_id, recipe_id, production_batch_id, movement_type,
    quantity_delta, unit, reason, created_by
  )
  values (
    v_recipe.business_id,
    v_recipe.id,
    v_batch_id,
    'production_output',
    p_quantity,
    v_recipe.yield_unit::text,
    'Producción registrada ' || left(v_batch_id::text, 8),
    auth.uid()
  );

  return v_batch_id;
end
$$;

create table public.morfi_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.morfi_profiles(id) on delete restrict,
  business_id uuid not null references public.morfi_businesses(id) on delete restrict,
  request_key uuid not null,
  request_fingerprint text not null,
  status public.morfi_order_status not null default 'pending',
  delivery_mode text not null check (delivery_mode in ('pickup', 'delivery')),
  delivery_address text,
  payment_method text not null check (payment_method in ('cash', 'transfer')),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (customer_id, request_key),
  check (
    (delivery_mode = 'delivery' and nullif(btrim(delivery_address), '') is not null)
    or (delivery_mode = 'pickup' and delivery_address is null)
  )
);

create table public.morfi_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  business_id uuid not null,
  product_id uuid not null,
  recipe_id uuid,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  cash_discount_percent numeric(5, 2)
    check (cash_discount_percent is null or cash_discount_percent between 0 and 100),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (order_id, product_id),
  foreign key (order_id, business_id)
    references public.morfi_orders(id, business_id) on delete cascade,
  foreign key (product_id, business_id)
    references public.morfi_business_products(id, business_id) on delete restrict,
  foreign key (recipe_id, business_id)
    references public.morfi_recipes(id, business_id) on delete restrict
);

create table public.morfi_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  request_key uuid not null,
  supplier_name text not null default '' check (length(supplier_name) <= 120),
  purchased_at date not null default current_date,
  created_by uuid not null references public.morfi_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, request_key),
  unique (id, business_id)
);

create table public.morfi_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null,
  business_id uuid not null,
  ingredient_id uuid not null,
  ingredient_name text not null,
  purchase_quantity numeric(14, 4) not null check (purchase_quantity > 0),
  purchase_unit public.morfi_measure_unit not null,
  purchase_price numeric(12, 2) not null check (purchase_price >= 0),
  stock_added numeric(14, 4) not null check (stock_added > 0),
  created_at timestamptz not null default now(),
  unique (purchase_id, ingredient_id),
  foreign key (purchase_id, business_id)
    references public.morfi_purchases(id, business_id) on delete cascade,
  foreign key (ingredient_id, business_id)
    references public.morfi_ingredients(id, business_id) on delete restrict
);

create table public.morfi_sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  recipe_id uuid not null,
  request_key uuid not null,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  unit_cost numeric(12, 4) not null check (unit_cost >= 0),
  total_revenue numeric(12, 2) not null check (total_revenue >= 0),
  total_cost numeric(12, 2) not null check (total_cost >= 0),
  real_profit numeric(12, 2) not null,
  sold_at date not null default current_date,
  created_by uuid not null references public.morfi_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, request_key),
  unique (id, business_id),
  foreign key (recipe_id, business_id)
    references public.morfi_recipes(id, business_id) on delete restrict
);

create index morfi_purchases_business_date
on public.morfi_purchases (business_id, purchased_at desc);
create index morfi_sales_business_date
on public.morfi_sales (business_id, sold_at desc);

create table public.morfi_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  ingredient_id uuid,
  recipe_id uuid,
  product_id uuid,
  order_id uuid,
  production_batch_id uuid,
  purchase_id uuid,
  sale_id uuid,
  movement_type public.morfi_inventory_movement_type not null,
  quantity_delta numeric(14, 4) not null check (quantity_delta <> 0),
  unit text not null check (length(btrim(unit)) between 1 and 20),
  reason text not null check (length(btrim(reason)) between 1 and 300),
  created_by uuid not null references public.morfi_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (num_nonnulls(ingredient_id, recipe_id, product_id) = 1),
  check (num_nonnulls(order_id, production_batch_id, purchase_id, sale_id) <= 1),
  foreign key (ingredient_id, business_id)
    references public.morfi_ingredients(id, business_id) on delete restrict,
  foreign key (recipe_id, business_id)
    references public.morfi_recipes(id, business_id) on delete restrict,
  foreign key (product_id, business_id)
    references public.morfi_business_products(id, business_id) on delete restrict,
  foreign key (order_id, business_id)
    references public.morfi_orders(id, business_id) on delete restrict,
  foreign key (production_batch_id, business_id)
    references public.morfi_production_batches(id, business_id) on delete restrict,
  foreign key (purchase_id, business_id)
    references public.morfi_purchases(id, business_id) on delete restrict,
  foreign key (sale_id, business_id)
    references public.morfi_sales(id, business_id) on delete restrict
);

create index morfi_inventory_movements_business_created
on public.morfi_inventory_movements (business_id, created_at desc);

create or replace function public.morfi_record_purchase(
  p_business_id uuid,
  p_request_key uuid,
  p_items jsonb,
  p_purchased_at date,
  p_supplier_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid;
  v_item record;
  v_ingredient public.morfi_ingredients%rowtype;
  v_stock_added numeric(14, 4);
begin
  if auth.uid() is null
    or p_business_id is null
    or not public.morfi_has_business_access(
      p_business_id,
      array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
    )
  then
    raise exception 'An authorized business session is required';
  end if;
  if p_request_key is null
    or p_purchased_at is null
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or length(coalesce(p_supplier_name, '')) > 120
  then
    raise exception 'Purchase data is incomplete or invalid';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'A purchase must include between 1 and 100 ingredients';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as rows(item)
    where jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'ingredient_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(item ->> 'purchase_unit', '') not in ('g', 'kg', 'ml', 'l', 'unidad')
      or coalesce(item ->> 'purchase_quantity', '') !~ '^[0-9]+([.][0-9]{1,4})?$'
      or coalesce(item ->> 'purchase_price', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or (item ->> 'purchase_quantity')::numeric <= 0
      or (item ->> 'purchase_price')::numeric < 0
  ) then
    raise exception 'Each purchase line needs a valid ingredient, unit, quantity, and price';
  end if;
  if exists (
    select item ->> 'ingredient_id'
    from jsonb_array_elements(p_items) as rows(item)
    group by item ->> 'ingredient_id'
    having count(*) > 1
  ) then
    raise exception 'A purchase may contain each ingredient only once';
  end if;

  insert into public.morfi_purchases (
    business_id, request_key, supplier_name, purchased_at, created_by
  )
  values (
    p_business_id, p_request_key, btrim(coalesce(p_supplier_name, '')),
    p_purchased_at, auth.uid()
  )
  on conflict (business_id, request_key) do nothing
  returning id into v_purchase_id;

  if v_purchase_id is null then
    select id into v_purchase_id
    from public.morfi_purchases
    where business_id = p_business_id and request_key = p_request_key;
    return v_purchase_id;
  end if;

  for v_item in
    select
      (item ->> 'ingredient_id')::uuid as ingredient_id,
      (item ->> 'purchase_quantity')::numeric as purchase_quantity,
      (item ->> 'purchase_unit')::public.morfi_measure_unit as purchase_unit,
      (item ->> 'purchase_price')::numeric as purchase_price
    from jsonb_array_elements(p_items) as rows(item)
    order by (item ->> 'ingredient_id')::uuid
  loop
    select *
    into v_ingredient
    from public.morfi_ingredients
    where id = v_item.ingredient_id and business_id = p_business_id
    for update;
    if not found or v_ingredient.purchase_unit <> v_item.purchase_unit then
      raise exception 'Ingredient not found or purchase unit does not match';
    end if;

    v_stock_added := v_item.purchase_quantity
      * public.morfi_unit_factor(v_item.purchase_unit)
      / public.morfi_unit_factor(v_ingredient.stock_unit);

    update public.morfi_ingredients
    set purchase_quantity = v_item.purchase_quantity,
        purchase_price = v_item.purchase_price,
        stock_quantity = stock_quantity + v_stock_added,
        updated_at = now()
    where id = v_ingredient.id and business_id = p_business_id;

    insert into public.morfi_purchase_items (
      purchase_id, business_id, ingredient_id, ingredient_name,
      purchase_quantity, purchase_unit, purchase_price, stock_added
    )
    values (
      v_purchase_id, p_business_id, v_ingredient.id, v_ingredient.name,
      v_item.purchase_quantity, v_item.purchase_unit, v_item.purchase_price,
      v_stock_added
    );

    insert into public.morfi_inventory_movements (
      business_id, ingredient_id, purchase_id, movement_type,
      quantity_delta, unit, reason, created_by
    )
    values (
      p_business_id, v_ingredient.id, v_purchase_id, 'purchase',
      v_stock_added, v_ingredient.stock_unit::text,
      'Compra registrada ' || left(v_purchase_id::text, 8), auth.uid()
    );
  end loop;

  return v_purchase_id;
end
$$;

create or replace function public.morfi_record_sale(
  p_recipe_id uuid,
  p_quantity numeric,
  p_request_key uuid,
  p_sold_at date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe public.morfi_recipes%rowtype;
  v_sale_id uuid;
  v_unit_cost numeric(12, 4);
  v_total_cost numeric(12, 2);
  v_total_revenue numeric(12, 2);
begin
  if auth.uid() is null or p_recipe_id is null or p_request_key is null
    or p_quantity is null or p_quantity = 'NaN'::numeric
    or p_quantity <= 0 or p_sold_at is null
  then
    raise exception 'Sale data is incomplete or invalid';
  end if;

  select sale.id
  into v_sale_id
  from public.morfi_sales sale
  where sale.request_key = p_request_key
    and sale.recipe_id = p_recipe_id
    and sale.quantity = p_quantity
    and public.morfi_has_business_access(
      sale.business_id,
      array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
    );
  if found then
    return v_sale_id;
  end if;

  select *
  into v_recipe
  from public.morfi_recipes recipe
  where recipe.id = p_recipe_id
    and public.morfi_has_business_access(
      recipe.business_id,
      array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
    )
  for update;
  if not found then
    raise exception 'Recipe not found or not accessible to the current user';
  end if;
  if p_quantity > 10000
    or (v_recipe.yield_unit = 'unidades' and p_quantity <> trunc(p_quantity))
  then
    raise exception 'Sale quantity is outside the permitted range';
  end if;
  if v_recipe.selling_price is null or v_recipe.selling_price <= 0 then
    raise exception 'Set a selling price for this recipe before recording a sale';
  end if;
  if v_recipe.finished_stock < p_quantity then
    raise exception 'Insufficient finished stock for this sale';
  end if;
  if not exists (
    select 1
    from public.morfi_recipe_ingredients
    where recipe_id = v_recipe.id and business_id = v_recipe.business_id
  ) then
    raise exception 'The recipe needs at least one ingredient before recording a sale';
  end if;

  select (
    coalesce(sum(
      line.quantity
      * public.morfi_unit_factor(line.unit)
      * ingredient.purchase_price
      / (ingredient.purchase_quantity * public.morfi_unit_factor(ingredient.purchase_unit))
    ), 0)
    + v_recipe.additional_costs
  ) / v_recipe.yield_quantity
  into v_unit_cost
  from public.morfi_recipe_ingredients line
  join public.morfi_ingredients ingredient
    on ingredient.id = line.ingredient_id
    and ingredient.business_id = line.business_id
  where line.recipe_id = v_recipe.id
    and line.business_id = v_recipe.business_id;

  v_total_revenue := round(v_recipe.selling_price * p_quantity, 2);
  v_total_cost := round(v_unit_cost * p_quantity, 2);

  insert into public.morfi_sales (
    business_id, recipe_id, recipe_name, request_key, quantity, unit_price, unit_cost,
    total_revenue, total_cost, real_profit, sold_at, created_by
  )
  values (
    v_recipe.business_id, v_recipe.id, v_recipe.name, p_request_key, p_quantity,
    v_recipe.selling_price, v_unit_cost, v_total_revenue, v_total_cost,
    v_total_revenue - v_total_cost, p_sold_at, auth.uid()
  )
  on conflict (business_id, request_key) do nothing
  returning id into v_sale_id;

  if v_sale_id is null then
    select id into v_sale_id
    from public.morfi_sales
    where business_id = v_recipe.business_id and request_key = p_request_key
      and recipe_id = v_recipe.id and quantity = p_quantity;
    if v_sale_id is null then
      raise exception 'The request key was already used for a different sale';
    end if;
    return v_sale_id;
  end if;

  update public.morfi_recipes
  set finished_stock = finished_stock - p_quantity,
      updated_at = now()
  where id = v_recipe.id
    and business_id = v_recipe.business_id
    and finished_stock >= p_quantity;
  if not found then
    raise exception 'Finished stock changed while recording the sale';
  end if;

  insert into public.morfi_inventory_movements (
    business_id, recipe_id, sale_id, movement_type,
    quantity_delta, unit, reason, created_by
  )
  values (
    v_recipe.business_id, v_recipe.id, v_sale_id, 'manual_sale',
    -p_quantity, v_recipe.yield_unit::text,
    'Venta registrada ' || left(v_sale_id::text, 8), auth.uid()
  );

  return v_sale_id;
end
$$;

create or replace function public.morfi_protect_ingredient_units()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.purchase_unit is distinct from old.purchase_unit
    or new.stock_unit is distinct from old.stock_unit
  then
    if exists (
      select 1
      from public.morfi_recipe_ingredients
      where ingredient_id = old.id and business_id = old.business_id
    ) or exists (
      select 1
      from public.morfi_inventory_movements
      where ingredient_id = old.id and business_id = old.business_id
    ) then
      raise exception 'Ingredient units cannot change after recipes or inventory movements have been recorded';
    end if;
  end if;
  return new;
end
$$;

create trigger morfi_ingredient_unit_history_guard
before update on public.morfi_ingredients
for each row execute function public.morfi_protect_ingredient_units();

create or replace function public.morfi_adjust_inventory(
  p_item_type text,
  p_item_id uuid,
  p_quantity_delta numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_new_quantity numeric;
  v_unit text;
  v_movement_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_item_type is null
    or p_item_type not in ('ingredient', 'recipe', 'product')
    or p_item_id is null
    or p_quantity_delta is null
    or p_quantity_delta = 'NaN'::numeric
    or abs(p_quantity_delta) > 10000000
    or p_quantity_delta = 0
    or p_reason is null
    or length(btrim(p_reason)) not between 1 and 300
  then
    raise exception 'A valid inventory item, quantity change, and reason are required';
  end if;

  if p_item_type = 'ingredient' then
    select business_id, stock_unit::text
    into v_business_id, v_unit
    from public.morfi_ingredients
    where id = p_item_id
    for update;
    if not found or not public.morfi_has_business_access(
      v_business_id,
      array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
    ) then
      raise exception 'Ingredient not found or not accessible to the current user';
    end if;
    update public.morfi_ingredients
    set stock_quantity = stock_quantity + p_quantity_delta,
        updated_at = now()
    where id = p_item_id
      and business_id = v_business_id
      and stock_quantity + p_quantity_delta >= 0
    returning stock_quantity into v_new_quantity;
  elsif p_item_type = 'recipe' then
    select business_id, yield_unit::text
    into v_business_id, v_unit
    from public.morfi_recipes
    where id = p_item_id
    for update;
    if not found or not public.morfi_has_business_access(
      v_business_id,
      array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
    ) then
      raise exception 'Recipe not found or not accessible to the current user';
    end if;
    update public.morfi_recipes
    set finished_stock = finished_stock + p_quantity_delta,
        updated_at = now()
    where id = p_item_id
      and business_id = v_business_id
      and finished_stock + p_quantity_delta >= 0
    returning finished_stock into v_new_quantity;
  else
    if p_quantity_delta <> trunc(p_quantity_delta) then
      raise exception 'Listed product quantities must be whole numbers';
    end if;
    select business_id
    into v_business_id
    from public.morfi_business_products
    where id = p_item_id and recipe_id is null
    for update;
    if not found or not public.morfi_has_business_access(
      v_business_id,
      array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
    ) then
      raise exception 'Unlinked product not found or not accessible to the current user';
    end if;
    v_unit := 'unidad';
    update public.morfi_business_products
    set stock_quantity = stock_quantity + p_quantity_delta,
        updated_at = now()
    where id = p_item_id
      and business_id = v_business_id
      and recipe_id is null
      and stock_quantity + p_quantity_delta >= 0
    returning stock_quantity into v_new_quantity;
  end if;

  if not found then
    raise exception 'The inventory change would result in a negative quantity';
  end if;

  insert into public.morfi_inventory_movements (
    id, business_id, ingredient_id, recipe_id, product_id, movement_type,
    quantity_delta, unit, reason, created_by
  )
  values (
    v_movement_id,
    v_business_id,
    case when p_item_type = 'ingredient' then p_item_id end,
    case when p_item_type = 'recipe' then p_item_id end,
    case when p_item_type = 'product' then p_item_id end,
    'manual_adjustment',
    p_quantity_delta,
    v_unit,
    btrim(p_reason),
    auth.uid()
  );

  return v_movement_id;
end
$$;

create or replace function public.morfi_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger morfi_businesses_updated_at
before update on public.morfi_businesses
for each row execute function public.morfi_set_updated_at();

create trigger morfi_business_creator_guard
before update on public.morfi_businesses
for each row execute function public.morfi_protect_workspace_creator();

create trigger morfi_business_products_updated_at
before update on public.morfi_business_products
for each row execute function public.morfi_set_updated_at();

create trigger morfi_suppliers_updated_at
before update on public.morfi_suppliers
for each row execute function public.morfi_set_updated_at();

create trigger morfi_supplier_creator_guard
before update on public.morfi_suppliers
for each row execute function public.morfi_protect_workspace_creator();

create trigger morfi_supplier_products_updated_at
before update on public.morfi_supplier_products
for each row execute function public.morfi_set_updated_at();

create trigger morfi_ingredients_updated_at
before update on public.morfi_ingredients
for each row execute function public.morfi_set_updated_at();

create trigger morfi_recipes_updated_at
before update on public.morfi_recipes
for each row execute function public.morfi_set_updated_at();

create trigger morfi_orders_updated_at
before update on public.morfi_orders
for each row execute function public.morfi_set_updated_at();

create trigger morfi_basket_lists_updated_at
before update on public.morfi_basket_lists
for each row execute function public.morfi_set_updated_at();

create or replace function public.morfi_create_order(
  p_business_id uuid,
  p_items jsonb,
  p_delivery_mode text,
  p_delivery_address text,
  p_payment_method text,
  p_request_key uuid,
  p_request_key uuid
)
returns uuid
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
  v_existing_fingerprint text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_business_id is null or p_request_key is null then
    raise exception 'Business and idempotency key are required';
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
    '|', p_business_id::text, p_items::text, p_delivery_mode,
    coalesce(p_delivery_address, ''), p_payment_method
  ));
  select id, request_fingerprint
  into v_order_id, v_existing_fingerprint
  from public.morfi_orders
  where customer_id = auth.uid() and request_key = p_request_key;
  if found then
    if v_existing_fingerprint <> v_request_fingerprint then
      raise exception 'This request key was already used for a different order';
    end if;
    return v_order_id;
  end if;

  select *
  into v_business
  from public.morfi_businesses
  where id = p_business_id and is_published and is_open
  for share;
  if not found then
    raise exception 'Business is unavailable';
  end if;
  if not (p_payment_method = any(v_business.payment_methods)) then
    raise exception 'Payment method is unavailable for this business';
  end if;
  if p_delivery_mode = 'delivery' then
    if not v_business.accepts_delivery or nullif(btrim(p_delivery_address), '') is null then
      raise exception 'Delivery is unavailable or the address is missing';
    end if;
    v_delivery_fee := v_business.delivery_fee;
  elsif not v_business.accepts_pickup then
    raise exception 'Pickup is unavailable for this business';
  end if;

  insert into public.morfi_orders (
    id, customer_id, business_id, request_key, request_fingerprint,
    delivery_mode, delivery_address, payment_method, delivery_fee
  )
  values (
    v_order_id,
    auth.uid(),
    v_business.id,
    p_request_key,
    v_request_fingerprint,
    p_delivery_mode,
    case when p_delivery_mode = 'delivery' then btrim(p_delivery_address) else null end,
    p_payment_method,
    v_delivery_fee
  )
  on conflict (customer_id, request_key) do nothing;
  if not found then
    select id, request_fingerprint
    into v_order_id, v_existing_fingerprint
    from public.morfi_orders
    where customer_id = auth.uid() and request_key = p_request_key;
    if v_existing_fingerprint <> v_request_fingerprint then
      raise exception 'This request key was already used for a different order';
    end if;
    return v_order_id;
  end if;

  -- Aggregate duplicate product lines and lock in a stable order to prevent overselling.
  for v_item in
    select (entry ->> 'product_id')::uuid as product_id,
           sum((entry ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entries(entry)
    group by (entry ->> 'product_id')::uuid
    order by (entry ->> 'product_id')::uuid
  loop
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
      order_id, business_id, product_id, recipe_id, product_name, quantity, unit_price,
      cash_discount_percent, line_total
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
      v_line_total
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'At least one valid product is required';
  end if;

  update public.morfi_orders
  set subtotal = round(v_subtotal, 2),
      discount_total = round(v_discount, 2),
      total = round(v_subtotal - v_discount + v_delivery_fee, 2),
      updated_at = now()
  where id = v_order_id;

  return v_order_id;
end
$$;

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
    for v_item in
      select product_id, recipe_id
      from public.morfi_order_items
      where order_id = v_order.id and business_id = v_order.business_id
      order by product_id
    loop
      perform 1
      from public.morfi_business_products
      where id = v_item.product_id and business_id = v_order.business_id
      for update;
      if not found then
        raise exception 'Product inventory for this order is unavailable';
      end if;

      if v_item.recipe_id is not null then
        perform 1
        from public.morfi_recipes
        where id = v_item.recipe_id and business_id = v_order.business_id
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
      where order_id = v_order.id
        and business_id = v_order.business_id
        and recipe_id is not null
      group by recipe_id
    ) as item_totals
    where recipe.id = item_totals.recipe_id
      and recipe.business_id = v_order.business_id;

    update public.morfi_business_products product
    set stock_quantity = product.stock_quantity + item_totals.quantity,
        updated_at = now()
    from (
      select product_id, sum(quantity)::integer as quantity
      from public.morfi_order_items
      where order_id = v_order.id
        and business_id = v_order.business_id
        and recipe_id is null
      group by product_id
    ) as item_totals
    where product.id = item_totals.product_id
      and product.business_id = v_order.business_id;

    insert into public.morfi_inventory_movements (
      business_id, recipe_id, order_id, movement_type,
      quantity_delta, unit, reason, created_by
    )
    select
      v_order.business_id,
      item_totals.recipe_id,
      v_order.id,
      'order_return',
      item_totals.quantity,
      recipe.yield_unit::text,
      'Devolución por pedido ' || p_new_status::text || ' ' || left(v_order.id::text, 8),
      auth.uid()
    from (
      select recipe_id, sum(quantity)::numeric(14, 4) as quantity
      from public.morfi_order_items
      where order_id = v_order.id
        and business_id = v_order.business_id
        and recipe_id is not null
      group by recipe_id
    ) as item_totals
    join public.morfi_recipes recipe
      on recipe.id = item_totals.recipe_id
      and recipe.business_id = v_order.business_id;

    insert into public.morfi_inventory_movements (
      business_id, product_id, order_id, movement_type,
      quantity_delta, unit, reason, created_by
    )
    select
      v_order.business_id,
      item_totals.product_id,
      v_order.id,
      'order_return',
      item_totals.quantity,
      'unidad',
      'Devolución por pedido ' || p_new_status::text || ' ' || left(v_order.id::text, 8),
      auth.uid()
    from (
      select product_id, sum(quantity)::numeric(14, 4) as quantity
      from public.morfi_order_items
      where order_id = v_order.id
        and business_id = v_order.business_id
        and recipe_id is null
      group by product_id
    ) as item_totals;
  end if;

  update public.morfi_orders
  set status = p_new_status, updated_at = now()
  where id = p_order_id;
end
$$;

-- These views run with caller privileges/RLS and contain only public catalog fields.
create or replace view public.morfi_public_business_catalog
with (security_invoker = true, security_barrier = true)
as
select
  b.id as business_id,
  p.id as product_id,
  b.name as business_name,
  b.description as business_description,
  b.logo_path,
  b.accepts_delivery as business_accepts_delivery,
  b.accepts_pickup,
  b.delivery_fee,
  b.payment_methods as business_payment_methods,
  b.is_open,
  p.name as product_name,
  p.description as product_description,
  p.image_path,
  p.price,
  p.is_available,
  p.accepts_delivery,
  p.payment_methods,
  p.cash_discount_percent
from public.morfi_businesses b
join public.morfi_business_products p on p.business_id = b.id
where b.is_published and p.is_available;

create or replace view public.morfi_public_supplier_catalog
with (security_invoker = true, security_barrier = true)
as
select
  s.id as supplier_id,
  p.id as product_id,
  s.name as supplier_name,
  s.description as supplier_description,
  s.logo_path,
  s.zone,
  p.name as product_name,
  p.description as product_description,
  p.category,
  p.comparison_key,
  p.sale_unit,
  p.image_path,
  p.price,
  p.is_available,
  p.accepts_delivery,
  p.payment_methods,
  p.cash_discount_percent
from public.morfi_suppliers s
join public.morfi_supplier_products p on p.supplier_id = s.id
where s.is_published and p.is_available;

-- Contact data is returned only through these publication/consent-checked RPCs.
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
    case when 'transfer' = any(business.payment_methods) then business.transfer_alias end,
    case when 'transfer' = any(business.payment_methods) then business.transfer_holder end,
    business.location,
    business.directions
  from public.morfi_businesses business
  where business.id = p_business_id and business.is_published
$$;

create or replace function public.morfi_public_supplier_contact(p_supplier_id uuid)
returns table (contact_phone text, contact_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when supplier.phone_is_public then supplier.contact_phone end,
    case when supplier.email_is_public then supplier.contact_email end
  from public.morfi_suppliers supplier
  where supplier.id = p_supplier_id and supplier.is_published
$$;

alter table public.morfi_profiles enable row level security;
alter table public.morfi_businesses enable row level security;
alter table public.morfi_business_memberships enable row level security;
alter table public.morfi_business_products enable row level security;
alter table public.morfi_suppliers enable row level security;
alter table public.morfi_supplier_memberships enable row level security;
alter table public.morfi_supplier_products enable row level security;
alter table public.morfi_ingredients enable row level security;
alter table public.morfi_recipes enable row level security;
alter table public.morfi_recipe_ingredients enable row level security;
alter table public.morfi_production_batches enable row level security;
alter table public.morfi_production_batch_items enable row level security;
alter table public.morfi_inventory_movements enable row level security;
alter table public.morfi_orders enable row level security;
alter table public.morfi_order_items enable row level security;
alter table public.morfi_supplier_promotions enable row level security;
alter table public.morfi_basket_lists enable row level security;
alter table public.morfi_basket_items enable row level security;
alter table public.morfi_purchases enable row level security;
alter table public.morfi_purchase_items enable row level security;
alter table public.morfi_sales enable row level security;

revoke all on public.morfi_profiles,
  public.morfi_businesses,
  public.morfi_business_memberships,
  public.morfi_business_products,
  public.morfi_suppliers,
  public.morfi_supplier_memberships,
  public.morfi_supplier_products,
  public.morfi_ingredients,
  public.morfi_recipes,
  public.morfi_recipe_ingredients,
  public.morfi_production_batches,
  public.morfi_production_batch_items,
  public.morfi_inventory_movements,
  public.morfi_orders,
  public.morfi_order_items,
  public.morfi_supplier_promotions,
  public.morfi_basket_lists,
  public.morfi_basket_items,
  public.morfi_purchases,
  public.morfi_purchase_items,
  public.morfi_sales
from anon, authenticated;

grant select on public.morfi_profiles to authenticated;
grant update (
  full_name, phone, dni, enabled_panels, seller_alias, seller_holder,
  seller_location, seller_directions, seller_logo_path
) on public.morfi_profiles to authenticated;

-- Anonymous table reads are column-limited to public listing fields only.
grant select (
  id, name, description, logo_path, accepts_delivery, accepts_pickup,
  delivery_fee, payment_methods, is_open, is_published
) on public.morfi_businesses to anon;
grant select (
  id, business_id, name, description, image_path, price,
  is_available, accepts_delivery, payment_methods, cash_discount_percent
) on public.morfi_business_products to anon;
grant select (
  id, name, description, logo_path, zone, is_published
) on public.morfi_suppliers to anon;
grant select (
  id, supplier_id, name, description, category, comparison_key, sale_unit, image_path, price,
  is_available, accepts_delivery, payment_methods, cash_discount_percent
) on public.morfi_supplier_products to anon;

grant select, insert, update on public.morfi_businesses to authenticated;
grant select on public.morfi_business_memberships to authenticated;
grant select, delete on public.morfi_business_products to authenticated;
grant insert (
  business_id, name, description, image_path, price, is_available,
  accepts_delivery, payment_methods, cash_discount_percent, recipe_id
) on public.morfi_business_products to authenticated;
grant update (
  name, description, image_path, price, is_available, accepts_delivery,
  payment_methods, cash_discount_percent
) on public.morfi_business_products to authenticated;
grant select, insert, update on public.morfi_suppliers to authenticated;
grant select on public.morfi_supplier_memberships to authenticated;
grant select, insert, update, delete on public.morfi_supplier_products to authenticated;
grant select, insert, update, delete on public.morfi_supplier_promotions to authenticated;
grant select, insert, update, delete on public.morfi_basket_lists,
  public.morfi_basket_items to authenticated;
grant select, delete on public.morfi_ingredients to authenticated;
grant insert (
  business_id, name, purchase_quantity, purchase_unit, purchase_price, stock_unit
) on public.morfi_ingredients to authenticated;
grant update (
  name, purchase_quantity, purchase_unit, purchase_price, stock_unit
) on public.morfi_ingredients to authenticated;
grant select, delete on public.morfi_recipes to authenticated;
grant insert (
  business_id, name, yield_quantity, yield_unit, additional_costs, selling_price
) on public.morfi_recipes to authenticated;
grant update (
  name, yield_quantity, yield_unit, additional_costs, selling_price
) on public.morfi_recipes to authenticated;
grant select, insert, update, delete on public.morfi_recipe_ingredients to authenticated;
grant select on public.morfi_production_batches,
  public.morfi_production_batch_items,
  public.morfi_inventory_movements to authenticated;
grant select on public.morfi_orders, public.morfi_order_items to authenticated;
grant select on public.morfi_purchases, public.morfi_purchase_items,
  public.morfi_sales to authenticated;

grant select on public.morfi_public_business_catalog,
  public.morfi_public_supplier_catalog to anon, authenticated;

create policy "profiles_select_own"
on public.morfi_profiles for select to authenticated
using (id = (select auth.uid()));

create policy "profiles_update_own"
on public.morfi_profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "businesses_select_published"
on public.morfi_businesses for select to anon, authenticated
using (is_published);

create policy "businesses_select_members"
on public.morfi_businesses for select to authenticated
using (public.morfi_has_business_access(id));

create policy "businesses_insert_creator"
on public.morfi_businesses for insert to authenticated
with check (created_by = (select auth.uid()));

create policy "businesses_update_managers"
on public.morfi_businesses for update to authenticated
using (public.morfi_has_business_access(
  id, array['owner', 'manager']::public.morfi_workspace_role[]
))
with check (
  public.morfi_has_business_access(
    id, array['owner', 'manager']::public.morfi_workspace_role[]
  )
);

create policy "business_memberships_select_self_or_owner"
on public.morfi_business_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or public.morfi_has_business_access(
    business_id, array['owner']::public.morfi_workspace_role[]
  )
);

create policy "business_products_select_published"
on public.morfi_business_products for select to anon, authenticated
using (
  is_available and exists (
    select 1 from public.morfi_businesses business
    where business.id = business_id and business.is_published
  )
);

create policy "business_products_select_members"
on public.morfi_business_products for select to authenticated
using (public.morfi_has_business_access(business_id));

create policy "business_products_insert_members"
on public.morfi_business_products for insert to authenticated
with check (public.morfi_has_business_access(
  business_id, array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
));

create policy "business_products_update_members"
on public.morfi_business_products for update to authenticated
using (public.morfi_has_business_access(
  business_id, array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
))
with check (public.morfi_has_business_access(
  business_id, array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
));

create policy "business_products_delete_managers"
on public.morfi_business_products for delete to authenticated
using (public.morfi_has_business_access(
  business_id, array['owner', 'manager']::public.morfi_workspace_role[]
));

create policy "suppliers_select_published"
on public.morfi_suppliers for select to anon, authenticated
using (is_published);

create policy "suppliers_select_members"
on public.morfi_suppliers for select to authenticated
using (public.morfi_has_supplier_access(id));

create policy "suppliers_insert_creator"
on public.morfi_suppliers for insert to authenticated
with check (created_by = (select auth.uid()));

create policy "suppliers_update_managers"
on public.morfi_suppliers for update to authenticated
using (public.morfi_has_supplier_access(
  id, array['owner', 'manager']::public.morfi_workspace_role[]
))
with check (
  public.morfi_has_supplier_access(
    id, array['owner', 'manager']::public.morfi_workspace_role[]
  )
);

create policy "supplier_memberships_select_self_or_owner"
on public.morfi_supplier_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or public.morfi_has_supplier_access(
    supplier_id, array['owner']::public.morfi_workspace_role[]
  )
);

create policy "supplier_products_select_published"
on public.morfi_supplier_products for select to anon, authenticated
using (
  is_available and exists (
    select 1 from public.morfi_suppliers supplier
    where supplier.id = supplier_id and supplier.is_published
  )
);

create policy "supplier_products_select_members"
on public.morfi_supplier_products for select to authenticated
using (public.morfi_has_supplier_access(supplier_id));

create policy "supplier_products_insert_members"
on public.morfi_supplier_products for insert to authenticated
with check (public.morfi_has_supplier_access(
  supplier_id, array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
));

create policy "supplier_products_update_members"
on public.morfi_supplier_products for update to authenticated
using (public.morfi_has_supplier_access(
  supplier_id, array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
))
with check (public.morfi_has_supplier_access(
  supplier_id, array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
));

create policy "supplier_products_delete_managers"
on public.morfi_supplier_products for delete to authenticated
using (public.morfi_has_supplier_access(
  supplier_id, array['owner', 'manager']::public.morfi_workspace_role[]
));

create policy "ingredients_select_members"
on public.morfi_ingredients for select to authenticated
using (public.morfi_has_business_access(business_id));
create policy "ingredients_insert_members"
on public.morfi_ingredients for insert to authenticated
with check (public.morfi_has_business_access(
  business_id, array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
));
create policy "ingredients_update_members"
on public.morfi_ingredients for update to authenticated
using (public.morfi_has_business_access(business_id))
with check (public.morfi_has_business_access(business_id));
create policy "ingredients_delete_managers"
on public.morfi_ingredients for delete to authenticated
using (public.morfi_has_business_access(
  business_id, array['owner', 'manager']::public.morfi_workspace_role[]
));

create policy "recipes_select_members"
on public.morfi_recipes for select to authenticated
using (public.morfi_has_business_access(business_id));
create policy "recipes_insert_members"
on public.morfi_recipes for insert to authenticated
with check (public.morfi_has_business_access(
  business_id, array['owner', 'manager', 'staff']::public.morfi_workspace_role[]
));
create policy "recipes_update_members"
on public.morfi_recipes for update to authenticated
using (public.morfi_has_business_access(business_id))
with check (public.morfi_has_business_access(business_id));
create policy "recipes_delete_managers"
on public.morfi_recipes for delete to authenticated
using (public.morfi_has_business_access(
  business_id, array['owner', 'manager']::public.morfi_workspace_role[]
));

create policy "recipe_ingredients_select_members"
on public.morfi_recipe_ingredients for select to authenticated
using (public.morfi_has_business_access(business_id));
create policy "recipe_ingredients_insert_members"
on public.morfi_recipe_ingredients for insert to authenticated
with check (public.morfi_has_business_access(business_id));
create policy "recipe_ingredients_update_members"
on public.morfi_recipe_ingredients for update to authenticated
using (public.morfi_has_business_access(business_id))
with check (public.morfi_has_business_access(business_id));
create policy "recipe_ingredients_delete_managers"
on public.morfi_recipe_ingredients for delete to authenticated
using (public.morfi_has_business_access(
  business_id, array['owner', 'manager']::public.morfi_workspace_role[]
));

create policy "production_batches_select_members"
on public.morfi_production_batches for select to authenticated
using (public.morfi_has_business_access(business_id));

create policy "production_batch_items_select_members"
on public.morfi_production_batch_items for select to authenticated
using (public.morfi_has_business_access(business_id));

create policy "inventory_movements_select_members"
on public.morfi_inventory_movements for select to authenticated
using (public.morfi_has_business_access(business_id));

create policy "orders_select_participant"
on public.morfi_orders for select to authenticated
using (
  customer_id = (select auth.uid())
  or public.morfi_has_business_access(business_id)
);

create policy "order_items_select_participant"
on public.morfi_order_items for select to authenticated
using (
  exists (
    select 1 from public.morfi_orders order_record
    where order_record.id = morfi_order_items.order_id
    and order_record.business_id = morfi_order_items.business_id
      and (
        order_record.customer_id = (select auth.uid())
        or public.morfi_has_business_access(order_record.business_id)
      )
  )
);

create policy "supplier_promotions_select_published_or_members"
on public.morfi_supplier_promotions for select to anon, authenticated
using (
  (
    is_active and ends_at > now() and exists (
      select 1 from public.morfi_suppliers supplier
      where supplier.id = supplier_id and supplier.is_published
    )
  )
  or (
    auth.uid() is not null
    and public.morfi_has_supplier_access(supplier_id)
  )
);

create policy "supplier_promotions_insert_managers"
on public.morfi_supplier_promotions for insert to authenticated
with check (public.morfi_has_supplier_access(
  supplier_id, array['owner', 'manager']::public.morfi_workspace_role[]
));

create policy "supplier_promotions_update_managers"
on public.morfi_supplier_promotions for update to authenticated
using (public.morfi_has_supplier_access(
  supplier_id, array['owner', 'manager']::public.morfi_workspace_role[]
))
with check (public.morfi_has_supplier_access(
  supplier_id, array['owner', 'manager']::public.morfi_workspace_role[]
));

create policy "supplier_promotions_delete_managers"
on public.morfi_supplier_promotions for delete to authenticated
using (public.morfi_has_supplier_access(
  supplier_id, array['owner', 'manager']::public.morfi_workspace_role[]
));

create policy "basket_lists_owner_all"
on public.morfi_basket_lists for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "basket_items_owner_all"
on public.morfi_basket_items for all to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.morfi_basket_lists basket
    where basket.id = basket_id and basket.user_id = (select auth.uid())
  )
);

create policy "purchases_select_members"
on public.morfi_purchases for select to authenticated
using (public.morfi_has_business_access(business_id));

create policy "purchase_items_select_members"
on public.morfi_purchase_items for select to authenticated
using (public.morfi_has_business_access(business_id));

create policy "sales_select_members"
on public.morfi_sales for select to authenticated
using (public.morfi_has_business_access(business_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'morfi-catalog',
  'morfi-catalog',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'morfi-catalog'
      and bucket.public
      and bucket.file_size_limit = 5242880
      and bucket.allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'The morfi-catalog bucket already exists with incompatible privacy or upload limits';
  end if;
end
$$;

-- Public reads are intentional for catalog images; writes are scoped to workspace paths.
create policy "morfi_catalog_public_read"
on storage.objects for select to anon, authenticated
using (bucket_id = 'morfi-catalog');

create policy "morfi_catalog_member_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'morfi-catalog'
  and (
    (
      (storage.foldername(name))[1] = 'businesses'
      and public.morfi_has_business_access(
        case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[2])::uuid
          else null
        end
      )
    )
    or (
      (storage.foldername(name))[1] = 'suppliers'
      and public.morfi_has_supplier_access(
        case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[2])::uuid
          else null
        end
      )
    )
  )
);

create policy "morfi_catalog_member_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'morfi-catalog'
  and (
    (
      (storage.foldername(name))[1] = 'businesses'
      and public.morfi_has_business_access(
        case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[2])::uuid
          else null
        end
      )
    )
    or (
      (storage.foldername(name))[1] = 'suppliers'
      and public.morfi_has_supplier_access(
        case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[2])::uuid
          else null
        end
      )
    )
  )
)
with check (
  bucket_id = 'morfi-catalog'
  and (
    (
      (storage.foldername(name))[1] = 'businesses'
      and public.morfi_has_business_access(
        case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[2])::uuid
          else null
        end
      )
    )
    or (
      (storage.foldername(name))[1] = 'suppliers'
      and public.morfi_has_supplier_access(
        case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[2])::uuid
          else null
        end
      )
    )
  )
);

create policy "morfi_catalog_member_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'morfi-catalog'
  and (
    (
      (storage.foldername(name))[1] = 'businesses'
      and public.morfi_has_business_access(
        case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[2])::uuid
          else null
        end
      )
    )
    or (
      (storage.foldername(name))[1] = 'suppliers'
      and public.morfi_has_supplier_access(
        case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[2])::uuid
          else null
        end
      )
    )
  )
);

revoke all on function public.morfi_unit_factor(public.morfi_measure_unit) from public, anon, authenticated;
revoke all on function public.morfi_has_business_access(uuid, public.morfi_workspace_role[]) from public, anon;
revoke all on function public.morfi_has_supplier_access(uuid, public.morfi_workspace_role[]) from public, anon;
revoke all on function public.morfi_add_business_member(uuid, uuid, public.morfi_workspace_role) from public, anon;
revoke all on function public.morfi_remove_business_member(uuid, uuid) from public, anon;
revoke all on function public.morfi_add_supplier_member(uuid, uuid, public.morfi_workspace_role) from public, anon;
revoke all on function public.morfi_remove_supplier_member(uuid, uuid) from public, anon;
revoke all on function public.morfi_record_production(uuid, numeric) from public, anon;
revoke all on function public.morfi_adjust_inventory(text, uuid, numeric, text) from public, anon;
revoke all on function public.morfi_create_order(uuid, jsonb, text, text, text, uuid) from public, anon;
revoke all on function public.morfi_record_purchase(uuid, uuid, jsonb, date, text) from public, anon;
revoke all on function public.morfi_record_sale(uuid, numeric, uuid, date) from public, anon;
revoke all on function public.morfi_update_order_status(uuid, public.morfi_order_status) from public, anon;
revoke all on function public.morfi_public_business_contact(uuid) from public;
revoke all on function public.morfi_public_supplier_contact(uuid) from public;

grant execute on function public.morfi_has_business_access(uuid, public.morfi_workspace_role[]) to authenticated;
grant execute on function public.morfi_has_supplier_access(uuid, public.morfi_workspace_role[]) to authenticated;
grant execute on function public.morfi_add_business_member(uuid, uuid, public.morfi_workspace_role) to authenticated;
grant execute on function public.morfi_remove_business_member(uuid, uuid) to authenticated;
grant execute on function public.morfi_add_supplier_member(uuid, uuid, public.morfi_workspace_role) to authenticated;
grant execute on function public.morfi_remove_supplier_member(uuid, uuid) to authenticated;
grant execute on function public.morfi_record_production(uuid, numeric) to authenticated;
grant execute on function public.morfi_adjust_inventory(text, uuid, numeric, text) to authenticated;
grant execute on function public.morfi_create_order(uuid, jsonb, text, text, text, uuid) to authenticated;
grant execute on function public.morfi_record_purchase(uuid, uuid, jsonb, date, text) to authenticated;
grant execute on function public.morfi_record_sale(uuid, numeric, uuid, date) to authenticated;
grant execute on function public.morfi_update_order_status(uuid, public.morfi_order_status) to authenticated;
grant execute on function public.morfi_public_business_contact(uuid) to anon, authenticated;
grant execute on function public.morfi_public_supplier_contact(uuid) to anon, authenticated;

commit;
