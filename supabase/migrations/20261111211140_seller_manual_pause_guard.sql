-- A billing edit must not reopen a manually paused shop. Expired exceptions stay expired.
begin;
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
 elsif b.hours_mode='manual' then return query select (b.is_open and b.order_override is distinct from 'paused'),case when b.order_override='paused' then 'paused' when b.is_open then 'open' else 'closed' end,null::timestamptz,null::timestamptz;
 elsif b.override_until>p_at and b.order_override='paused' then return query select false,'paused',b.override_until,b.override_until;
 elsif b.override_until>p_at and b.order_override='open' then return query select true,'exceptional',next_start,b.override_until;
 else return query select scheduled_open,case when scheduled_open then 'open' else 'closed' end,next_start,null::timestamptz;
 end if;
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
 select case when hours_mode='manual' or override_until>now() then order_override end into v_override from public.morfi_businesses where id=p_id;
 update public.morfi_businesses set hours_mode='scheduled',order_override=null,override_until=null where id=p_id;
 if v_override is not null then perform morfi_private.set_override(p_id,case v_override when 'paused' then 'pause' else 'open' end); end if;
end $$;
revoke all on function morfi_private.availability(uuid,timestamptz),morfi_private.replace_hours(uuid,jsonb) from public,anon,authenticated;
commit;
