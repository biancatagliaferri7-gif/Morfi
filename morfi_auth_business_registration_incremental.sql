-- Apply after morfi_supabase_migration.sql and morfi_platform_features_incremental.sql.
-- New entrepreneur signups create their business in the same auth transaction.

begin;

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
    payment_methods,
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
    v_payment_methods,
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

commit;
