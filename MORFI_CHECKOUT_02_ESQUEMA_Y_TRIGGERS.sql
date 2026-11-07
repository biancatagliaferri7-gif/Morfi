begin;
-- A zero in the old business configuration is ambiguous. Treat it as pending,
-- while leaving every existing order's amount and status untouched.
alter table public.morfi_businesses
  add column if not exists delivery_fee_status text;

alter table public.morfi_businesses disable trigger morfi_businesses_updated_at;

update public.morfi_businesses
set delivery_fee_status = case
  when delivery_fee > 0 then 'fixed'
  else 'pending'
end
where delivery_fee_status is null;

alter table public.morfi_businesses enable trigger morfi_businesses_updated_at;

alter table public.morfi_businesses
  alter column delivery_fee_status set default 'pending',
  alter column delivery_fee_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_businesses'::regclass
      and conname = 'morfi_businesses_delivery_fee_status_valid'
  ) then
    alter table public.morfi_businesses
      add constraint morfi_businesses_delivery_fee_status_valid
      check (
        (delivery_fee_status = 'pending' and delivery_fee = 0)
        or (delivery_fee_status = 'free' and delivery_fee = 0)
        or (delivery_fee_status = 'fixed' and delivery_fee > 0)
      );
  end if;
end
$$;

-- Expose only the non-sensitive delivery quote state alongside public catalog data.
grant select (delivery_fee_status)
  on public.morfi_businesses to anon, authenticated;

alter table public.morfi_orders
  add column if not exists delivery_references text,
  add column if not exists customer_notes text,
  add column if not exists delivery_fee_status text,
  add column if not exists transfer_bank_snapshot text,
  add column if not exists transfer_alias_snapshot text,
  add column if not exists transfer_holder_snapshot text,
  add column if not exists order_number bigint,
  add column if not exists checkout_fingerprint text;

alter table public.morfi_order_items
  add column if not exists customer_notes text;

-- Keep old numeric values intact; only new pending quotes may have unknown totals.
alter table public.morfi_orders
  alter column delivery_fee drop not null,
  alter column total drop not null;

alter table public.morfi_orders disable trigger morfi_orders_updated_at;

update public.morfi_orders
set delivery_fee_status = 'legacy'
where delivery_fee_status is null;

alter table public.morfi_orders
  alter column delivery_fee_status set default 'legacy',
  alter column delivery_fee_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_delivery_fee_status_valid'
  ) then
    alter table public.morfi_orders
      add constraint morfi_orders_delivery_fee_status_valid
      check (
        delivery_fee_status in ('pending', 'free', 'fixed', 'not_applicable', 'legacy')
        and (
          delivery_fee_status = 'legacy'
          or (
            delivery_fee_status = 'pending'
            and delivery_mode = 'delivery'
            and delivery_fee is null
            and total is null
          )
          or (
            delivery_fee_status = 'free'
            and delivery_mode = 'delivery'
            and delivery_fee = 0
            and total is not null
          )
          or (
            delivery_fee_status = 'fixed'
            and delivery_mode = 'delivery'
            and delivery_fee > 0
            and total is not null
          )
          or (
            delivery_fee_status = 'not_applicable'
            and delivery_mode = 'pickup'
            and delivery_fee = 0
            and total is not null
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_checkout_text_lengths'
  ) then
    alter table public.morfi_orders
      add constraint morfi_orders_checkout_text_lengths
      check (
        (delivery_references is null or length(delivery_references) <= 300)
        and (customer_notes is null or length(customer_notes) <= 1000)
        and (transfer_bank_snapshot is null or length(transfer_bank_snapshot) <= 120)
        and (transfer_alias_snapshot is null or length(transfer_alias_snapshot) <= 120)
        and (transfer_holder_snapshot is null or length(transfer_holder_snapshot) <= 120)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_order_items'::regclass
      and conname = 'morfi_order_items_customer_notes_length'
  ) then
    alter table public.morfi_order_items
      add constraint morfi_order_items_customer_notes_length
      check (customer_notes is null or length(customer_notes) <= 500);
  end if;
end
$$;

-- New transfer orders remain unpaid until the seller optionally reviews them.
alter table public.morfi_orders
  drop constraint if exists morfi_orders_payment_status_valid;

alter table public.morfi_orders
  add constraint morfi_orders_payment_status_valid
  check (payment_status in (
    'not_applicable',
    'awaiting_collection',
    'awaiting_delivery_quote',
    'pending_verification',
    'pending_payment',
    'verified',
    'rejected'
  ));

do $$
begin
  alter table public.morfi_orders
    drop constraint if exists morfi_orders_delivery_quote_payment_guard;

  alter table public.morfi_orders
    add constraint morfi_orders_delivery_quote_payment_guard
    check (
      delivery_fee_status <> 'pending'
      or (
        delivery_mode = 'delivery'
        and (
          (payment_method = 'transfer' and payment_status in ('pending_payment', 'awaiting_delivery_quote'))
          or (payment_method = 'cash' and payment_status = 'awaiting_collection')
        )
      )
    );

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_checkout_fingerprint_length'
  ) then
    alter table public.morfi_orders
      add constraint morfi_orders_checkout_fingerprint_length
      check (checkout_fingerprint is null or length(checkout_fingerprint) = 32);
  end if;
end
$$;

-- Assign visible, persistent numbers to old and new orders. Existing order IDs,
-- financial values, statuses, and timestamps are not changed by this backfill.
create sequence if not exists public.morfi_order_number_seq;

alter table public.morfi_orders
  alter column order_number
  set default nextval('public.morfi_order_number_seq'::regclass);

with current_max as (
  select coalesce(max(order_number), 0) as last_number
  from public.morfi_orders
), numbered_orders as (
  select order_record.id,
    current_max.last_number
      + row_number() over (order by order_record.created_at, order_record.id) as assigned_number
  from public.morfi_orders order_record
  cross join current_max
  where order_record.order_number is null
)
update public.morfi_orders order_record
set order_number = numbered_orders.assigned_number
from numbered_orders
where order_record.id = numbered_orders.id;

alter table public.morfi_orders enable trigger morfi_orders_updated_at;

do $$
declare
  v_next_number bigint;
begin
  select coalesce(max(order_number), 0) + 1
  into v_next_number
  from public.morfi_orders;

  execute format(
    'alter sequence public.morfi_order_number_seq restart with %s',
    v_next_number
  );
end
$$;

alter table public.morfi_orders
  alter column order_number set not null;

create unique index if not exists morfi_orders_order_number_unique
  on public.morfi_orders (order_number);

create or replace function public.morfi_prepare_order_checkout_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.morfi_businesses%rowtype;
begin
  if current_setting('morfi.checkout_v2', true) is distinct from 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.order_number is null then
      new.order_number := nextval('public.morfi_order_number_seq'::regclass);
    end if;

    select *
    into v_business
    from public.morfi_businesses
    where id = new.business_id;
    if not found then
      raise exception 'Business is unavailable';
    end if;

    if new.delivery_mode = 'pickup' then
      new.delivery_fee_status := 'not_applicable';
      new.delivery_fee := 0;
    else
      new.delivery_fee_status := v_business.delivery_fee_status;
      if v_business.delivery_fee_status = 'pending' then
        new.delivery_fee := null;
        new.total := null;
      elsif v_business.delivery_fee_status = 'free' then
        new.delivery_fee := 0;
      elsif v_business.delivery_fee_status = 'fixed' then
        new.delivery_fee := v_business.delivery_fee;
      else
        raise exception 'Business delivery fee configuration is invalid';
      end if;
    end if;

    if new.payment_method = 'transfer' then
      new.transfer_alias_snapshot := v_business.transfer_alias;
      new.transfer_bank_snapshot := null;
      new.transfer_holder_snapshot := null;
    end if;
    if new.delivery_fee_status = 'pending' then
      new.payment_status := case
        when new.payment_method = 'transfer' then 'pending_payment'
        else 'awaiting_collection'
      end;
    elsif new.payment_method = 'transfer' then
      new.payment_status := 'pending_payment';
    end if;
    return new;
  end if;

  if new.delivery_fee_status = 'pending' then
    new.delivery_fee := null;
    new.total := null;
    new.payment_status := case
      when new.payment_method = 'transfer' then 'pending_payment'
      else 'awaiting_collection'
    end;
  elsif new.delivery_fee_status = 'not_applicable' then
    new.delivery_fee := 0;
    new.total := round(new.subtotal - new.discount_total, 2);
  elsif new.delivery_fee_status = 'free' then
    new.delivery_fee := 0;
    new.total := round(new.subtotal - new.discount_total, 2);
    if old.delivery_fee_status = 'pending' then
      new.payment_status := case
        when new.payment_method = 'transfer' then 'pending_payment'
        else 'awaiting_collection'
      end;
    end if;
  elsif new.delivery_fee_status = 'fixed' then
    if new.delivery_fee is null or new.delivery_fee <= 0 then
      raise exception 'A positive delivery fee is required for a fixed quote';
    end if;
    new.total := round(new.subtotal - new.discount_total + new.delivery_fee, 2);
    if old.delivery_fee_status = 'pending' then
      new.payment_status := case
        when new.payment_method = 'transfer' then 'pending_payment'
        else 'awaiting_collection'
      end;
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.morfi_prepare_order_checkout_snapshots()
  from public, anon, authenticated;

drop trigger if exists zz_morfi_orders_checkout_prepare_insert on public.morfi_orders;
create trigger zz_morfi_orders_checkout_prepare_insert
before insert on public.morfi_orders
for each row execute function public.morfi_prepare_order_checkout_snapshots();

drop trigger if exists zz_morfi_orders_checkout_prepare_update on public.morfi_orders;
create trigger zz_morfi_orders_checkout_prepare_update
before update of subtotal, discount_total, total, delivery_fee, delivery_mode, delivery_fee_status
on public.morfi_orders
for each row execute function public.morfi_prepare_order_checkout_snapshots();

create or replace function public.morfi_block_delivery_progress_without_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.delivery_mode = 'delivery'
    and new.delivery_fee_status = 'pending'
    and new.status in (
      'on_the_way'::public.morfi_order_status,
      'delivered'::public.morfi_order_status
    )
  then
    raise exception 'A delivery order needs a confirmed delivery fee before it can be dispatched or delivered';
  end if;

  return new;
end
$$;

revoke all on function public.morfi_block_delivery_progress_without_quote()
  from public, anon, authenticated;

drop trigger if exists morfi_orders_block_delivery_progress_without_quote on public.morfi_orders;
create trigger morfi_orders_block_delivery_progress_without_quote
before update of status on public.morfi_orders
for each row execute function public.morfi_block_delivery_progress_without_quote();

-- Checkout RPC preflight and versioned routines; legacy morfi_create_order is unchanged.

commit;
