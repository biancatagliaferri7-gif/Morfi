-- READ ONLY: run before installing this release. Do not replay old setup SQL.
select current_database() as database_name,version() as postgres_version;
select table_name,column_name,udt_name from information_schema.columns
where table_schema='public' and table_name in ('morfi_profiles','morfi_businesses','morfi_business_products','morfi_orders','morfi_order_status_history')
order by table_name,ordinal_position;
select proname,pg_get_function_identity_arguments(oid) as arguments,
 position('Insufficient finished stock' in pg_get_functiondef(oid))=0 as has_no_stock_gate
from pg_proc where pronamespace='public'::regnamespace and proname in ('morfi_create_order','morfi_create_order_v2','morfi_managed_business_settings');
select tablename,policyname,roles,cmd from pg_policies where schemaname='public' and tablename like 'morfi_%' order by tablename,policyname;
select event_object_table,trigger_name,action_timing,event_manipulation from information_schema.triggers where trigger_schema='public' order by event_object_table,trigger_name;
