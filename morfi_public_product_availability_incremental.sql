-- Expose only whether a published product has finished stock.
-- The quantities and unpublished businesses remain private.
begin;

create or replace function public.morfi_public_product_availability()
returns table (product_id uuid, in_stock boolean)
language sql stable security definer
set search_path = ''
as $$
  select
    product.id,
    case
      when product.recipe_id is null then product.stock_quantity > 0
      else coalesce(recipe.finished_stock, 0) > 0
    end
  from public.morfi_business_products as product
  join public.morfi_businesses as business on business.id = product.business_id
  left join public.morfi_recipes as recipe
    on recipe.id = product.recipe_id and recipe.business_id = product.business_id
  where business.is_published = true
    and product.is_available = true;
$$;

revoke all on function public.morfi_public_product_availability() from public, anon, authenticated;
grant execute on function public.morfi_public_product_availability() to anon, authenticated;

commit;
