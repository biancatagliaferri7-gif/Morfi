-- MORFI Mercado opt-in migration.
-- Apply this file in the Supabase SQL Editor only after reviewing and confirming it.
-- Existing suppliers remain excluded because show_in_market defaults to false.

begin;

alter table public.morfi_suppliers
  add column if not exists show_in_market boolean;

update public.morfi_suppliers
set show_in_market = false
where show_in_market is null;

alter table public.morfi_suppliers
  alter column show_in_market set default false,
  alter column show_in_market set not null;

comment on column public.morfi_suppliers.show_in_market is
  'Supplier opt-in for displaying available products in the Tengo hambre Mercado catalog.';

grant select (show_in_market)
  on public.morfi_suppliers to anon, authenticated;

create or replace view public.morfi_public_market_catalog
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
where s.is_published
  and s.show_in_market
  and p.is_available;

grant select on public.morfi_public_market_catalog to anon, authenticated;

commit;
