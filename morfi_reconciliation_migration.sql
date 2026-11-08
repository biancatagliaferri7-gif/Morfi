-- MORFI integration on Bianca's 22d1208 schema.
-- Run AFTER her existing schema/registration/checkout migrations, before deploying
-- this frontend. Do not use this script to initialize or reset a database.
begin;

do $$
begin
  if to_regprocedure('public.morfi_create_business_from_signup()') is null
    or to_regprocedure('public.morfi_has_business_access(uuid,public.morfi_workspace_role[])') is null
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'morfi_businesses'
        and column_name = 'payment_method' and data_type = 'ARRAY')
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'morfi_businesses'
        and column_name = 'delivery_fee_status')
  then
    raise exception 'Apply and verify Bianca registration and checkout migrations first. No changes were applied.';
  end if;
end
$$;

-- Writes still require membership under the existing RLS policies.
grant insert (stock_quantity), update (stock_quantity)
on public.morfi_business_products to authenticated;

-- Bank/contact settings remain private: never grant table SELECT on these fields.
create or replace function public.morfi_managed_business_settings(p_business_id uuid)
returns table (
  is_open boolean, accepts_delivery boolean, accepts_pickup boolean,
  delivery_fee numeric, delivery_fee_status text, payment_method text[],
  contact_phone text, phone_is_public boolean, bank_name text, bank_cuit text,
  transfer_alias text, transfer_holder text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.morfi_has_business_access(
    p_business_id, array['owner', 'manager']::public.morfi_workspace_role[]
  ) then
    raise exception 'Only this business owner or manager can view its settings';
  end if;
  return query select b.is_open, b.accepts_delivery, b.accepts_pickup,
    b.delivery_fee, b.delivery_fee_status, b.payment_method,
    b.contact_phone, b.phone_is_public, b.bank_name, b.bank_cuit,
    b.transfer_alias, b.transfer_holder
  from public.morfi_businesses b where b.id = p_business_id;
end
$$;
revoke all on function public.morfi_managed_business_settings(uuid) from public, anon;
grant execute on function public.morfi_managed_business_settings(uuid) to authenticated;

-- Keep the full Bianca signup path; a lightweight signup explicitly defers setup.
-- This preference does not confer workspace access: membership/RLS still do that.
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
    or new.raw_user_meta_data ->> 'business_setup_deferred' = 'true'
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
  if exists (select 1 from jsonb_array_elements_text(new.raw_user_meta_data -> 'business_payment_methods') as methods(method)
    where method is null or method not in ('cash', 'transfer')) then
    raise exception 'The business payment method is invalid';
  end if;
  select coalesce(array_agg(distinct method order by method), array[]::text[])
  into v_payment_methods
  from jsonb_array_elements_text(new.raw_user_meta_data -> 'business_payment_methods') as methods(method);
  if cardinality(v_payment_methods) = 0 then
    raise exception 'At least one valid business payment method is required';
  end if;
  if 'transfer' = any(v_payment_methods) and (
    v_bank_name is null or length(v_bank_name) > 120
    or v_transfer_alias is null or length(v_transfer_alias) > 120
    or v_transfer_holder is null or length(v_transfer_holder) > 120
    or v_bank_cuit is null or v_bank_cuit !~ '^[0-9]{11}$'
  ) then
    raise exception 'Complete the bank, alias, account holder, and valid CUIT for transfers';
  end if;
  insert into public.morfi_businesses (
    created_by, name, description, contact_phone, phone_is_public, location,
    payment_method, bank_name, bank_cuit, transfer_alias, transfer_holder
  ) values (
    new.id, v_name, v_description, new.raw_user_meta_data ->> 'phone', true, v_location,
    v_payment_methods,
    case when 'transfer' = any(v_payment_methods) then v_bank_name end,
    case when 'transfer' = any(v_payment_methods) then v_bank_cuit end,
    case when 'transfer' = any(v_payment_methods) then v_transfer_alias end,
    case when 'transfer' = any(v_payment_methods) then v_transfer_holder end
  );
  return new;
end
$$;
revoke all on function public.morfi_create_business_from_signup() from public, anon, authenticated;

commit;
