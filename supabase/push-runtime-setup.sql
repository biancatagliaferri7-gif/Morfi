-- Run only after deploying order-push and creating Vault secrets:
-- morfi_push_worker_url (https://PROJECT.supabase.co/functions/v1/order-push)
-- morfi_push_worker_secret (same value as Edge MORFI_PUSH_WORKER_SECRET).
-- These values must be entered in Vault, never committed into this file.
begin;
do $$ begin
 if not exists(select 1 from pg_extension where extname='pg_net') or not exists(select 1 from pg_extension where extname='pg_cron') then raise exception 'Enable pg_net and pg_cron in this project first'; end if;
 if (select count(*) from vault.decrypted_secrets where name in ('morfi_push_worker_url','morfi_push_worker_secret'))<>2 then raise exception 'Create both MORFI Vault secrets first'; end if;
end $$;
create or replace function morfi_private.dispatch_push_worker()
returns void language plpgsql security definer set search_path='' as $$
declare v_url text;v_secret text;
begin
 select decrypted_secret into v_url from vault.decrypted_secrets where name='morfi_push_worker_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='morfi_push_worker_secret';
 if v_url is null or v_secret is null then return; end if;
 perform net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','x-morfi-worker-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=5000);
exception when others then
 -- The persistent outbox and minute job retry: never reject an order for a push failure.
 raise log 'MORFI push dispatch deferred';
end $$;
create or replace function morfi_private.wake_order_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform morfi_private.dispatch_push_worker();return new;end $$;
revoke all on function morfi_private.dispatch_push_worker(),morfi_private.wake_order_push() from public,anon,authenticated;
drop trigger if exists morfi_push_wake on public.morfi_order_push_events;
create trigger morfi_push_wake after insert on public.morfi_order_push_events for each row execute function morfi_private.wake_order_push();
select cron.schedule('morfi-order-push-retry','* * * * *',$job$select morfi_private.dispatch_push_worker();$job$);
commit;
