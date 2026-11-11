import { PGlite } from "@electric-sql/pglite";
export const buyer = "11111111-1111-4111-8111-111111111111";
export const stranger = "22222222-2222-4222-8222-222222222222";
export async function sellerFixture() {
  const db = new PGlite();
  await db.exec(`
 create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;
 create type public.morfi_workspace_role as enum('owner','manager','staff');
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
 create function public.morfi_create_order_v2(uuid,jsonb,text,text,text,text,text,uuid) returns table(order_id uuid,order_number bigint) language sql as $$ select null::uuid,null::bigint where false $$;
 create table public.morfi_profiles(id uuid primary key,full_name text,dni text unique,phone text,enabled_panels text[] default array['cliente']);
 create table public.morfi_businesses(id uuid primary key default gen_random_uuid(),created_by uuid,name text,description text,location text,latitude double precision,longitude double precision,contact_phone text,phone_is_public boolean,payment_methods text[] default array['cash'],bank_name text,bank_cuit text,transfer_alias text,transfer_holder text,accepts_pickup boolean,accepts_delivery boolean,delivery_fee_status text,delivery_fee numeric,is_open boolean default false,is_published boolean default false);
 create table public.morfi_business_memberships(business_id uuid,user_id uuid,role public.morfi_workspace_role,primary key(business_id,user_id));
 create function public.morfi_has_business_access(uuid,public.morfi_workspace_role[] default array['owner','manager','staff']::public.morfi_workspace_role[]) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.morfi_business_memberships where business_id=$1 and user_id=auth.uid() and role=any($2)) $$;
 create table public.morfi_business_products(id uuid primary key default gen_random_uuid(),business_id uuid,payment_methods text[] default array['cash']);
 create table public.morfi_orders(id uuid primary key default gen_random_uuid(),business_id uuid,customer_id uuid,status text default 'pending',order_number bigint);
 insert into public.morfi_profiles(id,full_name,dni,phone) values('${buyer}','Persona de prueba','12345678','+5493804000000'),('${stranger}','Otra persona','87654321','+5493804000001');
 `);
  await db.query("insert into auth.users(id) values($1),($2)", [
    buyer,
    stranger,
  ]);
  return db;
}
