-- MORFI: add business fields required by registration and location features.
-- Safe to apply incrementally: new columns are nullable and existing rows are preserved.

begin;

alter table public.morfi_businesses
  add column if not exists bank_cuit text,
  add column if not exists bank_name text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_bank_cuit_valid'
  ) then
    alter table public.morfi_businesses
      add constraint morfi_businesses_bank_cuit_valid
      check (bank_cuit is null or bank_cuit ~ '^[0-9]{11}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_bank_name_length'
  ) then
    alter table public.morfi_businesses
      add constraint morfi_businesses_bank_name_length
      check (bank_name is null or length(bank_name) <= 120);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_coordinates_valid'
  ) then
    alter table public.morfi_businesses
      add constraint morfi_businesses_coordinates_valid
      check (
        (latitude is null) = (longitude is null)
        and (
          latitude is null
          or (
            latitude between -90 and 90
            and longitude between -180 and 180
          )
        )
      );
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
