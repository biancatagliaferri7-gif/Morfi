-- Incremental release; requires MORFI checkout V2 and its no-stock-gate repair.
begin;
do $$ begin
 if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.morfi_businesses') and attname='payment_methods' and atttypid='text[]'::regtype and not attisdropped)
 or not exists(select 1 from pg_attribute where attrelid=to_regclass('public.morfi_business_products') and attname='payment_methods' and atttypid='text[]'::regtype and not attisdropped)
 or to_regprocedure('public.morfi_create_order_v2(uuid,jsonb,text,text,text,text,text,uuid)') is null then raise exception 'Install and verify MORFI checkout V2 before this migration';end if;
end $$;
create schema if not exists morfi_private;
revoke all on schema morfi_private from public, anon, authenticated;
alter table public.morfi_businesses
  add column if not exists parent_business_id uuid references public.morfi_businesses(id),
  add column if not exists hours_mode text not null default 'manual' check (hours_mode in ('manual','scheduled')),
  add column if not exists order_override text check (order_override in ('paused','open')),
  add column if not exists override_until timestamptz;
create table if not exists public.morfi_business_hours (
  business_id uuid not null references public.morfi_businesses(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  slot integer not null check (slot in (0,1)),
  opens time not null, closes time not null,
  primary key (business_id,weekday,slot), check (opens <> closes)
);
create table if not exists public.morfi_seller_setup_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.morfi_profiles(id) on delete cascade,
  parent_business_id uuid references public.morfi_businesses(id),
  version integer not null default 1 check (version=1),
  step integer not null default 2 check (step between 2 and 4),
  data jsonb not null default '{}'::jsonb,
  result_business_id uuid references public.morfi_businesses(id),
  updated_at timestamptz not null default now()
);
create unique index if not exists morfi_seller_one_active_draft
on public.morfi_seller_setup_drafts(user_id,coalesce(parent_business_id,'00000000-0000-0000-0000-000000000000'::uuid))
where result_business_id is null;
alter table public.morfi_business_hours enable row level security;
alter table public.morfi_seller_setup_drafts enable row level security;
revoke all on public.morfi_business_hours, public.morfi_seller_setup_drafts from public,anon,authenticated;
grant select on public.morfi_business_hours, public.morfi_seller_setup_drafts to authenticated;
drop policy if exists own_setup on public.morfi_seller_setup_drafts;
create policy own_setup on public.morfi_seller_setup_drafts for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists managed_hours on public.morfi_business_hours;
create policy managed_hours on public.morfi_business_hours for select to authenticated
using(public.morfi_has_business_access(business_id,array['owner','manager']::public.morfi_workspace_role[]));

-- UTC instances of weekly intervals, including the previous day's overnight slot.
create or replace function morfi_private.hours_windows(p_id uuid,p_at timestamptz)
returns table(starts timestamptz,ends timestamptz) language sql stable set search_path='' as $$
 select (day::date+h.opens) at time zone 'America/Argentina/La_Rioja',
   (day::date+h.closes+case when h.closes<h.opens then interval '1 day' else interval '0 day' end)
     at time zone 'America/Argentina/La_Rioja'
 from generate_series((p_at at time zone 'America/Argentina/La_Rioja')::date-1,
   (p_at at time zone 'America/Argentina/La_Rioja')::date+8,interval '1 day') day
 join public.morfi_business_hours h on h.business_id=p_id and h.weekday=extract(dow from day)::integer
$$;
create or replace function morfi_private.availability(p_id uuid,p_at timestamptz default now())
returns table(is_open boolean,state text,next_open_at timestamptz,override_until timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare b public.morfi_businesses%rowtype; scheduled_open boolean; next_start timestamptz;
begin
 select * into b from public.morfi_businesses where id=p_id;
 if not found then return; end if;
 select exists(select 1 from morfi_private.hours_windows(p_id,p_at) w where p_at>=w.starts and p_at<w.ends),
   (select min(w.starts) from morfi_private.hours_windows(p_id,p_at) w where w.starts>p_at)
 into scheduled_open,next_start;
 if not b.is_published then return query select false,'unpublished',next_start,b.override_until;
 elsif b.hours_mode='manual' then return query select b.is_open,case when b.order_override='paused' then 'paused' when b.is_open then 'open' else 'closed' end,null::timestamptz,null::timestamptz;
 elsif b.override_until>p_at and b.order_override='paused' then return query select false,'paused',b.override_until,b.override_until;
 elsif b.override_until>p_at and b.order_override='open' then return query select true,'exceptional',next_start,b.override_until;
 else return query select scheduled_open,case when scheduled_open then 'open' else 'closed' end,next_start,null::timestamptz;
 end if;
end $$;
create or replace function public.morfi_public_business_availability(p_ids uuid[])
returns table(business_id uuid,is_open boolean,state text,next_open_at timestamptz,override_until timestamptz)
language sql stable security definer set search_path='' as $$
 select b.id,a.* from public.morfi_businesses b
 cross join lateral morfi_private.availability(b.id) a
 where b.id=any(p_ids) and b.is_published
$$;
create or replace function public.morfi_managed_availability(p_business_id uuid)
returns table(is_open boolean,state text,next_open_at timestamptz,override_until timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.morfi_has_business_access(p_business_id,array['owner','manager']::public.morfi_workspace_role[]) then raise exception 'Not authorized'; end if;
 return query select * from morfi_private.availability(p_business_id);
end $$;
create or replace function morfi_private.set_override(p_id uuid,p_action text)
returns void language plpgsql set search_path='' as $$
declare v_until timestamptz;
begin
 if p_action not in ('pause','resume','open') then raise exception 'Invalid action'; end if;
 if p_action='pause' then select min(w.starts) into v_until from morfi_private.hours_windows(p_id,now()) w where w.starts>now();
 elsif p_action='open' then select min(t) into v_until from morfi_private.hours_windows(p_id,now()) w cross join lateral (values(w.starts),(w.ends)) boundary(t) where t>now(); end if;
 update public.morfi_businesses set order_override=case p_action when 'pause' then 'paused' when 'open' then 'open' else null end,
   override_until=v_until, is_open=case when hours_mode='manual' then p_action<>'pause' else is_open end where id=p_id;
end $$;
create or replace function public.morfi_set_order_reception(p_business_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.morfi_has_business_access(p_business_id,array['owner','manager']::public.morfi_workspace_role[]) then raise exception 'Not authorized'; end if;
 perform 1 from public.morfi_businesses where id=p_business_id for update;
 perform morfi_private.set_override(p_business_id,p_action);
end $$;

create or replace function morfi_private.validate_hours(p_hours jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p_hours) is distinct from 'array' or jsonb_array_length(p_hours) not between 1 and 14 then raise exception 'Choose at least one opening time'; end if;
 if exists(select 1 from jsonb_to_recordset(p_hours) as h(weekday integer,slot integer,opens time,closes time) where weekday is null or weekday not between 0 and 6 or slot is null or slot not in(0,1) or opens is null or closes is null or opens=closes) then raise exception 'Invalid opening hours'; end if;
 if exists(select 1 from jsonb_to_recordset(p_hours) as h(weekday integer,slot integer) group by weekday,slot having count(*)>1) then raise exception 'Duplicate opening hours'; end if;
 if exists(
 with slots as(select weekday*1440+extract(epoch from opens)/60 as starts,weekday*1440+extract(epoch from closes)/60+case when closes<opens then 1440 else 0 end as ends from jsonb_to_recordset(p_hours) as h(weekday integer,opens time,closes time)),
 wrapped as(select * from slots union all select starts+10080,ends+10080 from slots)
 select 1 from wrapped a join wrapped b on a.starts<b.starts where a.ends>b.starts
 ) or exists(select 1 from jsonb_to_recordset(p_hours) as h(weekday integer,opens time) group by weekday,opens having count(*)>1) then raise exception 'Opening times overlap';end if;
end $$;
create or replace function morfi_private.replace_hours(p_id uuid,p_hours jsonb)
returns void language plpgsql set search_path='' as $$
declare r jsonb; v_day integer; v_slot integer; v_open time; v_close time; v_override text;
begin
 if jsonb_typeof(p_hours) is distinct from 'array' or jsonb_array_length(p_hours) not between 1 and 14 then raise exception 'Choose at least one opening time'; end if;
 perform morfi_private.validate_hours(p_hours);
 delete from public.morfi_business_hours where business_id=p_id;
 for r in select value from jsonb_array_elements(p_hours) loop
   v_day:=(r->>'weekday')::integer; v_slot:=(r->>'slot')::integer;
   v_open:=(r->>'opens')::time; v_close:=(r->>'closes')::time;
   insert into public.morfi_business_hours values(p_id,v_day,v_slot,v_open,v_close);
 end loop;
 update public.morfi_businesses set hours_mode='scheduled' where id=p_id returning order_override into v_override;
 if v_override is not null then perform morfi_private.set_override(p_id,case v_override when 'paused' then 'pause' else 'open' end); end if;
end $$;
create or replace function public.morfi_save_business_hours(p_business_id uuid,p_hours jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.morfi_has_business_access(p_business_id,array['owner','manager']::public.morfi_workspace_role[]) then raise exception 'Not authorized'; end if;
 perform 1 from public.morfi_businesses where id=p_business_id for update;
 perform morfi_private.replace_hours(p_business_id,p_hours);
end $$;
create or replace function public.morfi_save_seller_identity(p_name text,p_dni text,p_phone text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication is required'; end if;
 if length(btrim(p_name)) not between 2 and 120 or p_name is null then raise exception 'Full name is required'; end if;
 if p_dni is null or p_dni !~ '^[0-9]{7,10}$' then raise exception 'A valid DNI is required'; end if;
 if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'A valid public WhatsApp is required'; end if;
 update public.morfi_profiles set full_name=btrim(p_name),dni=p_dni,phone=p_phone where id=auth.uid();
 if not found then raise exception 'Profile not found'; end if;
 update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('full_name',btrim(p_name),'dni',p_dni,'phone',p_phone) where id=auth.uid();
end $$;
create or replace function public.morfi_get_seller_draft(p_parent_business_id uuid default null)
returns public.morfi_seller_setup_drafts language plpgsql security definer set search_path='' as $$
declare d public.morfi_seller_setup_drafts%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication is required'; end if;
 if p_parent_business_id is not null and not public.morfi_has_business_access(p_parent_business_id,array['owner']::public.morfi_workspace_role[]) then raise exception 'Only the owner can add branches'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||coalesce(p_parent_business_id::text,''),0));
 select * into d from public.morfi_seller_setup_drafts where user_id=auth.uid() and parent_business_id is not distinct from p_parent_business_id and result_business_id is null;
 if not found then insert into public.morfi_seller_setup_drafts(user_id,parent_business_id) values(auth.uid(),p_parent_business_id) returning * into d; end if;
 return d;
end $$;
create or replace function public.morfi_save_seller_draft(p_draft_id uuid,p_data jsonb,p_step integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication is required'; end if;
 if p_step is null or p_step not between 2 and 4 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 then raise exception 'Invalid draft'; end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('name','description','location','latitude','longitude','phone','hours','accepts_transfer','accepts_delivery','bank_name','bank_cuit','transfer_alias','transfer_holder')) then raise exception 'Unexpected draft field'; end if;
 if exists(select 1 from jsonb_each(p_data) e where e.key<>'hours' and jsonb_typeof(e.value) in ('object','array')) then raise exception 'Unexpected draft field';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_data->'hours','[]'::jsonb)) h, jsonb_object_keys(h) k where k not in ('weekday','slot','opens','closes')) then raise exception 'Unexpected opening hours field';end if;
 if p_step=4 then perform morfi_private.validate_hours(p_data->'hours'); end if;
 update public.morfi_seller_setup_drafts set data=p_data,step=p_step,updated_at=now() where id=p_draft_id and user_id=auth.uid() and result_business_id is null;
 if not found then raise exception 'Draft unavailable'; end if;
end $$;
create or replace function public.morfi_complete_seller_setup(p_draft_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.morfi_seller_setup_drafts%rowtype; x jsonb; v_id uuid; p public.morfi_profiles%rowtype; v_transfer boolean; v_phone text;
begin
 if auth.uid() is null then raise exception 'Authentication is required'; end if;
 select * into d from public.morfi_seller_setup_drafts where id=p_draft_id and user_id=auth.uid() for update;
 if not found then raise exception 'Draft unavailable'; end if;
 if d.result_business_id is not null then return d.result_business_id; end if;
 if d.parent_business_id is not null and not public.morfi_has_business_access(d.parent_business_id,array['owner']::public.morfi_workspace_role[]) then raise exception 'Only the owner can add branches'; end if;
 select * into p from public.morfi_profiles where id=auth.uid();
 if nullif(btrim(p.full_name),'') is null or p.dni is null or p.dni !~ '^[0-9]{7,10}$' then raise exception 'Complete your name and DNI'; end if;
 x:=d.data; v_transfer:=coalesce((x->>'accepts_transfer')::boolean,false); v_phone:=coalesce(nullif(x->>'phone',''),p.phone);
 if coalesce(length(btrim(x->>'name')),0) not between 1 and 120 or coalesce(length(btrim(x->>'location')),0) not between 1 and 180 then raise exception 'Business name and address are required'; end if;
 if (x->>'latitude') is null or (x->>'longitude') is null or (x->>'latitude')::double precision not between -90 and 90 or (x->>'longitude')::double precision not between -180 and 180 then raise exception 'Mark the selling point on the map'; end if;
 if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'A valid public WhatsApp is required'; end if;
 if v_transfer and (coalesce(length(btrim(x->>'bank_name')),0) not between 1 and 120 or coalesce(length(btrim(x->>'transfer_alias')),0) not between 1 and 120 or coalesce(length(btrim(x->>'transfer_holder')),0) not between 1 and 120 or coalesce(x->>'bank_cuit','') !~ '^[0-9]{11}$') then raise exception 'Complete the bank, alias, account holder, and valid CUIT for transfers'; end if;
 insert into public.morfi_businesses(created_by,parent_business_id,name,description,location,latitude,longitude,contact_phone,phone_is_public,payment_methods,bank_name,bank_cuit,transfer_alias,transfer_holder,accepts_pickup,accepts_delivery,delivery_fee_status,delivery_fee,is_open)
 values(auth.uid(),d.parent_business_id,btrim(x->>'name'),coalesce(x->>'description',''),btrim(x->>'location'),(x->>'latitude')::double precision,(x->>'longitude')::double precision,v_phone,true,
 case when v_transfer then array['cash','transfer'] else array['cash'] end,
 case when v_transfer then btrim(x->>'bank_name') end,case when v_transfer then x->>'bank_cuit' end,case when v_transfer then btrim(x->>'transfer_alias') end,case when v_transfer then btrim(x->>'transfer_holder') end,true,coalesce((x->>'accepts_delivery')::boolean,false),'pending',0,true) returning id into v_id;
 insert into public.morfi_business_memberships(business_id,user_id,role) values(v_id,auth.uid(),'owner') on conflict (business_id,user_id) do nothing;
 perform morfi_private.replace_hours(v_id,x->'hours');
 update public.morfi_profiles set enabled_panels=array(select distinct unnest(enabled_panels||array['cliente','emprendimiento'])) where id=auth.uid();
 update public.morfi_seller_setup_drafts set result_business_id=v_id,updated_at=now() where id=d.id;
 return v_id;
end $$;

-- Apply the same authoritative check to old and new checkout clients.
create or replace function morfi_private.guard_order_availability()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.morfi_businesses where id=new.business_id for update;
 if not coalesce((select a.is_open from morfi_private.availability(new.business_id) a),false) then raise exception 'Business is unavailable'; end if;
 return new;
end $$;
drop trigger if exists morfi_orders_availability_guard on public.morfi_orders;
create trigger morfi_orders_availability_guard before insert on public.morfi_orders for each row execute function morfi_private.guard_order_availability();

-- Keep is_open true for scheduled businesses: the guard and public RPC calculate
-- the actual state. The legacy boolean remains authoritative only in manual mode.
create or replace function morfi_private.keep_scheduled_open()
returns trigger language plpgsql set search_path='' as $$
begin if new.hours_mode='scheduled' then new.is_open:=true; end if; return new; end $$;
drop trigger if exists morfi_scheduled_open_compat on public.morfi_businesses;
create trigger morfi_scheduled_open_compat before insert or update on public.morfi_businesses for each row execute function morfi_private.keep_scheduled_open();
update public.morfi_businesses set payment_methods=array(select distinct unnest(payment_methods||array['cash'])) where not ('cash'=any(payment_methods));
update public.morfi_business_products set payment_methods=array(select distinct unnest(payment_methods||array['cash'])) where not ('cash'=any(payment_methods));

create or replace function morfi_private.ensure_cash_payment()
returns trigger language plpgsql set search_path='' as $$
begin new.payment_methods:=array(select distinct unnest(new.payment_methods||array['cash']));return new;end $$;
drop trigger if exists morfi_cash_always_available on public.morfi_businesses;
create trigger morfi_cash_always_available before insert or update of payment_methods on public.morfi_businesses for each row execute function morfi_private.ensure_cash_payment();
drop trigger if exists morfi_cash_always_available on public.morfi_business_products;
create trigger morfi_cash_always_available before insert or update of payment_methods on public.morfi_business_products for each row execute function morfi_private.ensure_cash_payment();

-- Apply the same transfer validation when settings are edited through the API.
create or replace function morfi_private.validate_transfer_settings()
returns trigger language plpgsql set search_path='' as $$
declare validate_fields boolean:=tg_op='INSERT';
begin
 if tg_op='UPDATE' then
   validate_fields:=('transfer'=any(new.payment_methods) and not ('transfer'=any(old.payment_methods)))
     or (new.bank_name,new.bank_cuit,new.transfer_alias,new.transfer_holder) is distinct from (old.bank_name,old.bank_cuit,old.transfer_alias,old.transfer_holder);
 end if;
 new.bank_cuit:=nullif(regexp_replace(coalesce(new.bank_cuit,''),'[^0-9]','','g'),'');
 if validate_fields and 'transfer'=any(new.payment_methods) and (
   coalesce(length(btrim(new.bank_name)),0) not between 1 and 120
   or coalesce(length(btrim(new.transfer_alias)),0) not between 1 and 120
   or coalesce(length(btrim(new.transfer_holder)),0) not between 1 and 120
   or coalesce(new.bank_cuit,'') !~ '^[0-9]{11}$'
 ) then raise exception 'Complete the bank, alias, account holder, and valid CUIT for transfers'; end if;
 return new;
end $$;
drop trigger if exists morfi_transfer_settings_validation on public.morfi_businesses;
create trigger morfi_transfer_settings_validation before insert or update of payment_methods,bank_name,bank_cuit,transfer_alias,transfer_holder on public.morfi_businesses for each row execute function morfi_private.validate_transfer_settings();

-- Explicit API privileges. Internal functions remain inaccessible to API roles.
revoke all on all functions in schema morfi_private from public,anon,authenticated;
revoke all on function public.morfi_public_business_availability(uuid[]),public.morfi_managed_availability(uuid),public.morfi_set_order_reception(uuid,text),public.morfi_save_business_hours(uuid,jsonb),public.morfi_save_seller_identity(text,text,text),public.morfi_get_seller_draft(uuid),public.morfi_save_seller_draft(uuid,jsonb,integer),public.morfi_complete_seller_setup(uuid) from public,anon,authenticated;
grant execute on function public.morfi_public_business_availability(uuid[]) to anon,authenticated;
grant execute on function public.morfi_managed_availability(uuid),public.morfi_set_order_reception(uuid,text),public.morfi_save_business_hours(uuid,jsonb),public.morfi_save_seller_identity(text,text,text),public.morfi_get_seller_draft(uuid),public.morfi_save_seller_draft(uuid,jsonb,integer),public.morfi_complete_seller_setup(uuid) to authenticated;
-- Legacy checkout delegates to the same V2 transaction (no stock gate).
create or replace function public.morfi_create_order(p_business_id uuid,p_items jsonb,p_delivery_mode text,p_delivery_address text,p_payment_method text,p_request_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 select o.order_id into v_id from public.morfi_create_order_v2(p_business_id,p_items,p_delivery_mode,p_delivery_address,null::text,p_payment_method,null::text,p_request_key) o;
 return v_id;
end $$;
revoke all on function public.morfi_create_order(uuid,jsonb,text,text,text,uuid) from public,anon;
grant execute on function public.morfi_create_order(uuid,jsonb,text,text,text,uuid) to authenticated;
create or replace function morfi_private.guard_business_operation_fields()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_op='INSERT' and (new.parent_business_id is not null or new.hours_mode<>'manual' or new.order_override is not null or new.override_until is not null) then raise exception 'Use the seller setup operation'; end if;
  if tg_op='UPDATE' and (new.parent_business_id is distinct from old.parent_business_id or new.hours_mode is distinct from old.hours_mode or new.order_override is distinct from old.order_override or new.override_until is distinct from old.override_until) then raise exception 'Use the business settings operation'; end if;
 end if;
 return new;
end $$;
drop trigger if exists morfi_business_operation_fields on public.morfi_businesses;
create trigger morfi_business_operation_fields before insert or update on public.morfi_businesses for each row execute function morfi_private.guard_business_operation_fields();
revoke all on all functions in schema morfi_private from public,anon,authenticated;
commit;
notify pgrst,'reload schema';
