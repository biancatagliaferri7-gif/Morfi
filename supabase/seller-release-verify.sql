-- Read-only checks after this release. Every boolean should be true.
select
 to_regprocedure('public.morfi_complete_seller_setup(uuid)') is not null as seller_setup_installed,
 to_regprocedure('public.morfi_public_business_availability(uuid[])') is not null as availability_installed,
 to_regprocedure('public.morfi_register_push(uuid,text,text,text)') is not null as push_installed,
 not has_function_privilege('anon','public.morfi_complete_seller_setup(uuid)','EXECUTE') as anonymous_setup_denied,
 not has_function_privilege('authenticated','public.morfi_claim_push_deliveries()','EXECUTE') as client_worker_denied,
 not has_column_privilege('anon','public.morfi_businesses','bank_cuit','SELECT') as public_bank_denied,
 not has_column_privilege('authenticated','public.morfi_push_subscriptions','endpoint','SELECT') as endpoints_private,
 (select count(*)=6 and bool_and(relrowsecurity) from pg_class where oid in ('public.morfi_business_hours'::regclass,'public.morfi_seller_setup_drafts'::regclass,'public.morfi_push_subscriptions'::regclass,'public.morfi_order_push_events'::regclass,'public.morfi_order_push_deliveries'::regclass,'public.morfi_push_delivery_attempts'::regclass)) as all_new_tables_have_rls;
