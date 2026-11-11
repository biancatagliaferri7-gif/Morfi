begin;
create table if not exists public.morfi_push_subscriptions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.morfi_profiles(id) on delete cascade,
 installation_id uuid not null, session_id uuid not null, endpoint text not null unique,
 p256dh text not null,auth_key text not null,enabled boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(user_id,installation_id)
);
create table if not exists public.morfi_order_push_events (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.morfi_orders(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table if not exists public.morfi_order_push_deliveries (
 event_id uuid references public.morfi_order_push_events(id) on delete cascade,
 subscription_id uuid references public.morfi_push_subscriptions(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','sent','failed','obsolete')),
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 lease_id uuid,lease_until timestamptz,last_error text,primary key(event_id,subscription_id)
);
create table if not exists public.morfi_push_delivery_attempts (
 lease_id uuid primary key,event_id uuid not null,subscription_id uuid not null,
 attempt integer not null,started_at timestamptz not null default now(),finished_at timestamptz,
 result text check(result in ('sent','retry','gone','failed')),error_code text,
 foreign key(event_id,subscription_id) references public.morfi_order_push_deliveries(event_id,subscription_id) on delete cascade
);
alter table public.morfi_push_delivery_attempts enable row level security;
revoke all on public.morfi_push_delivery_attempts from public,anon,authenticated;
grant all on public.morfi_push_delivery_attempts to service_role;
alter table public.morfi_push_subscriptions enable row level security;
alter table public.morfi_order_push_events enable row level security;
alter table public.morfi_order_push_deliveries enable row level security;
revoke all on public.morfi_push_subscriptions,public.morfi_order_push_events,public.morfi_order_push_deliveries from public,anon,authenticated;
grant all on public.morfi_push_subscriptions,public.morfi_order_push_events,public.morfi_order_push_deliveries to service_role;
grant select(id,installation_id,enabled) on public.morfi_push_subscriptions to authenticated;
drop policy if exists own_push on public.morfi_push_subscriptions;
create policy own_push on public.morfi_push_subscriptions for select to authenticated using(user_id=(select auth.uid()));
create or replace function public.morfi_register_push(p_installation_id uuid,p_endpoint text,p_p256dh text,p_auth text)
returns void language plpgsql security definer set search_path='' as $$
declare v_session uuid;
begin
 if auth.uid() is null then raise exception 'Authentication is required'; end if;
 v_session:=(auth.jwt()->>'session_id')::uuid;
 if v_session is null or not exists(select 1 from auth.sessions where id=v_session and user_id=auth.uid()) then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.morfi_business_memberships where user_id=auth.uid() and role in ('owner','manager')) then raise exception 'Seller access required'; end if;
 if p_installation_id is null or p_endpoint is null or length(p_endpoint)>2048
 or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]]+$'
 or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87,88}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22,24}$' then raise exception 'Invalid push subscription'; end if;
 if exists(select 1 from public.morfi_push_subscriptions where endpoint=p_endpoint and user_id<>auth.uid()) then raise exception 'Unsubscribe this device before switching accounts'; end if;
 insert into public.morfi_push_subscriptions(user_id,installation_id,session_id,endpoint,p256dh,auth_key)
 values(auth.uid(),p_installation_id,v_session,p_endpoint,p_p256dh,p_auth)
 on conflict(user_id,installation_id) do update set session_id=v_session,endpoint=p_endpoint,p256dh=p_p256dh,auth_key=p_auth,enabled=true,updated_at=now();
end $$;
create or replace function public.morfi_revoke_push(p_installation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication is required'; end if;
 update public.morfi_push_subscriptions set enabled=false,updated_at=now() where user_id=auth.uid() and installation_id=p_installation_id;
end $$;
create or replace function morfi_private.queue_order_push()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
 insert into public.morfi_order_push_events(order_id) values(new.id) on conflict(order_id) do nothing returning id into v_event;
 if v_event is not null then
 insert into public.morfi_order_push_deliveries(event_id,subscription_id)
 select v_event,s.id from public.morfi_push_subscriptions s
 join public.morfi_business_memberships m on m.user_id=s.user_id and m.business_id=new.business_id and m.role in ('owner','manager')
 where s.enabled on conflict do nothing;
 end if;return new;
end $$;
drop trigger if exists morfi_orders_queue_push on public.morfi_orders;
create trigger morfi_orders_queue_push after insert on public.morfi_orders for each row execute function morfi_private.queue_order_push();
create or replace function public.morfi_claim_push_deliveries()
returns table(event_id uuid,subscription_id uuid,lease_id uuid,endpoint text,p256dh text,auth_key text,user_id uuid,business_id uuid,order_id uuid,order_number bigint)
language plpgsql security definer set search_path='' as $$
begin
 update public.morfi_order_push_deliveries d set state='obsolete' from public.morfi_order_push_events e, public.morfi_orders o
 where d.event_id=e.id and e.order_id=o.id and d.state='pending' and (e.created_at<now()-interval '15 minutes' or o.status<>'pending');
 return query
 with candidates as (
 select d.event_id,d.subscription_id from public.morfi_order_push_deliveries d
 join public.morfi_order_push_events e on e.id=d.event_id join public.morfi_orders o on o.id=e.order_id
 join public.morfi_push_subscriptions s on s.id=d.subscription_id
 where d.state='pending' and d.attempts<5 and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now()) and s.enabled
 and exists(select 1 from auth.sessions a where a.id=s.session_id and a.user_id=s.user_id)
 and exists(select 1 from public.morfi_business_memberships m where m.business_id=o.business_id and m.user_id=s.user_id and m.role in ('owner','manager'))
 order by e.created_at limit 25 for update of d skip locked
 ), claimed as (
 update public.morfi_order_push_deliveries d set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=d.attempts+1
 from candidates c where d.event_id=c.event_id and d.subscription_id=c.subscription_id returning d.*
 ), recorded as (
 insert into public.morfi_push_delivery_attempts as a(lease_id,event_id,subscription_id,attempt)
 select c.lease_id,c.event_id,c.subscription_id,c.attempts from claimed c returning a.lease_id
 ) select d.event_id,d.subscription_id,d.lease_id,s.endpoint,s.p256dh,s.auth_key,s.user_id,o.business_id,o.id,o.order_number
 from claimed d join recorded r on r.lease_id=d.lease_id join public.morfi_push_subscriptions s on s.id=d.subscription_id
 join public.morfi_order_push_events e on e.id=d.event_id join public.morfi_orders o on o.id=e.order_id;
end $$;
create or replace function public.morfi_finish_push_delivery(p_event_id uuid,p_subscription_id uuid,p_lease_id uuid,p_result text,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_result not in ('sent','retry','gone','failed') then raise exception 'Invalid result'; end if;
 update public.morfi_order_push_deliveries set state=case when p_result='sent' then 'sent' when p_result='retry' and attempts<5 then 'pending' else 'failed' end,
 next_attempt_at=now()+make_interval(secs=>least(900,60*power(2,attempts-1)::integer)),lease_until=null,last_error=left(p_error,120)
 where event_id=p_event_id and subscription_id=p_subscription_id and lease_id=p_lease_id;
 if found then
  update public.morfi_push_delivery_attempts set finished_at=now(),result=p_result,error_code=left(p_error,120) where lease_id=p_lease_id and finished_at is null;
  if p_result='gone' then update public.morfi_push_subscriptions set enabled=false where id=p_subscription_id;end if;
 end if;
end $$;
revoke all on function public.morfi_register_push(uuid,text,text,text),public.morfi_revoke_push(uuid),public.morfi_claim_push_deliveries(),public.morfi_finish_push_delivery(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.morfi_register_push(uuid,text,text,text),public.morfi_revoke_push(uuid) to authenticated;
grant execute on function public.morfi_claim_push_deliveries(),public.morfi_finish_push_delivery(uuid,uuid,uuid,text,text) to service_role;
revoke all on function morfi_private.queue_order_push() from public,anon,authenticated;
commit;
notify pgrst,'reload schema';
