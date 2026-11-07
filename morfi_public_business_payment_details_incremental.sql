-- Public transfer alias for the MORFI checkout. No bank or account-holder data
-- is returned by this RPC.

begin;

create or replace function public.morfi_public_business_transfer_alias(
  p_business_id uuid
)
returns table (transfer_alias text)
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(business.transfer_alias), '')
  from public.morfi_businesses business
  where business.id = p_business_id
    and business.is_published
    and nullif(btrim(business.transfer_alias), '') is not null
$$;

revoke all on function public.morfi_public_business_transfer_alias(uuid)
  from public, anon, authenticated;
grant execute on function public.morfi_public_business_transfer_alias(uuid)
  to anon, authenticated;

do $$
begin
  if to_regprocedure('public.morfi_public_business_payment_details(uuid)') is not null then
    execute 'revoke all on function public.morfi_public_business_payment_details(uuid) from public, anon, authenticated';
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
