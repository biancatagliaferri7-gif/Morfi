-- MORFI pilot reconciliation migration.
-- Apply this once in a staging project, verify the checks in docs/PILOT-RELEASE.md,
-- and only then apply it to production.

begin;

-- Keep the repository schema aligned with the production market catalogue.
alter table public.morfi_suppliers
  add column if not exists show_in_market boolean not null default false;

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
where s.is_published and s.show_in_market and p.is_available;

grant select on public.morfi_public_market_catalog to anon, authenticated;

-- The vendor needs a minimal contact snapshot to coordinate a cash/transfer order.
-- It is populated only by the order function from the authenticated buyer's profile.
alter table public.morfi_orders
  add column if not exists customer_name text,
  add column if not exists customer_phone text;

create or replace function public.morfi_capture_order_customer_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select profile.full_name, profile.phone
  into new.customer_name, new.customer_phone
  from public.morfi_profiles profile
  where profile.id = new.customer_id;
  return new;
end
$$;

revoke all on function public.morfi_capture_order_customer_contact() from public, anon, authenticated;
drop trigger if exists morfi_order_customer_contact on public.morfi_orders;
create trigger morfi_order_customer_contact
before insert on public.morfi_orders
for each row execute function public.morfi_capture_order_customer_contact();

-- Product stock is set when a product is created or edited; purchases and orders
-- continue to update stock through the guarded RPCs.
grant insert (business_id, name, description, image_path, price, stock_quantity,
  is_available, accepts_delivery, payment_methods, cash_discount_percent, recipe_id)
on public.morfi_business_products to authenticated;
grant update (name, description, image_path, price, stock_quantity, is_available,
  accepts_delivery, payment_methods, cash_discount_percent)
on public.morfi_business_products to authenticated;

-- Do not permit anonymous direct reads of non-catalogue columns. Publication and
-- consent-aware contacts remain available only through the two public RPCs.
revoke all on public.morfi_businesses, public.morfi_business_products,
  public.morfi_suppliers, public.morfi_supplier_products from anon;
grant select (id, name, description, logo_path, accepts_delivery, accepts_pickup,
  delivery_fee, payment_methods, is_open, is_published)
on public.morfi_businesses to anon;
grant select (id, business_id, name, description, image_path, price, is_available,
  accepts_delivery, payment_methods, cash_discount_percent)
on public.morfi_business_products to anon;
grant select (id, name, description, logo_path, zone, is_published, show_in_market)
on public.morfi_suppliers to anon;
grant select (id, supplier_id, name, description, category, comparison_key, sale_unit,
  image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent)
on public.morfi_supplier_products to anon;

commit;
