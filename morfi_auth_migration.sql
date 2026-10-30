-- Apply after morfi_supabase_migration.sql on projects where the base schema already exists.
-- This contains only the profile changes required by phone/DNI authentication and panel setup.

begin;

alter table public.morfi_profiles
  add column if not exists dni text,
  add column if not exists enabled_panels text[] not null default array[]::text[],
  add column if not exists seller_alias text,
  add column if not exists seller_holder text,
  add column if not exists seller_location text,
  add column if not exists seller_directions text,
  add column if not exists seller_logo text;

create unique index if not exists morfi_profiles_dni_unique
  on public.morfi_profiles (dni)
  where dni is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'morfi_profiles_dni_format'
      and conrelid = 'public.morfi_profiles'::regclass
  ) then
    alter table public.morfi_profiles
      add constraint morfi_profiles_dni_format
      check (dni is null or dni ~ '^[0-9]{7,10}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'morfi_profiles_enabled_panels_valid'
      and conrelid = 'public.morfi_profiles'::regclass
  ) then
    alter table public.morfi_profiles
      add constraint morfi_profiles_enabled_panels_valid
      check (enabled_panels <@ array['cliente', 'emprendimiento', 'ahorro']::text[]);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'morfi_profiles_seller_logo_size'
      and conrelid = 'public.morfi_profiles'::regclass
  ) then
    alter table public.morfi_profiles
      add constraint morfi_profiles_seller_logo_size
      check (seller_logo is null or length(seller_logo) <= 1400000);
  end if;
end
$$;

grant update (
  full_name, phone, dni, enabled_panels, seller_alias, seller_holder,
  seller_location, seller_directions, seller_logo
) on public.morfi_profiles to authenticated;

commit;
