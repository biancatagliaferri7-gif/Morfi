-- MORFI order checkout details and delivery quote state.
-- Review and run only after the application using morfi_create_order_v2 is ready.
-- This migration does not rewrite historical order amounts, payment methods, or statuses.

begin;

do $$
declare
  v_missing_columns text;
begin
  if to_regclass('public.morfi_businesses') is null
    or to_regclass('public.morfi_orders') is null
    or to_regclass('public.morfi_order_items') is null
  then
    raise exception 'MORFI business/order tables are required before this migration';
  end if;

  if to_regprocedure('public.morfi_create_order(uuid,jsonb,text,text,text,uuid)') is null
    or to_regprocedure('public.morfi_has_business_access(uuid,public.morfi_workspace_role[])') is null
    or to_regprocedure('public.morfi_snapshot_order_customer()') is null
    or to_regprocedure('public.morfi_set_updated_at()') is null
  then
    raise exception 'The current MORFI order and business-access functions are required';
  end if;

  select string_agg(format('%I.%I', required.table_name, required.column_name), ', ')
  into v_missing_columns
  from (values
    ('morfi_businesses', 'id'),
    ('morfi_businesses', 'bank_name'),
    ('morfi_businesses', 'transfer_alias'),
    ('morfi_businesses', 'transfer_holder'),
    ('morfi_businesses', 'delivery_fee'),
    ('morfi_businesses', 'updated_at'),
    ('morfi_orders', 'id'),
    ('morfi_orders', 'business_id'),
    ('morfi_orders', 'customer_id'),
    ('morfi_orders', 'delivery_mode'),
    ('morfi_orders', 'delivery_address'),
    ('morfi_orders', 'payment_method'),
    ('morfi_orders', 'payment_status'),
    ('morfi_orders', 'subtotal'),
    ('morfi_orders', 'discount_total'),
    ('morfi_orders', 'delivery_fee'),
    ('morfi_orders', 'total'),
    ('morfi_orders', 'status'),
    ('morfi_orders', 'created_at'),
    ('morfi_orders', 'updated_at'),
    ('morfi_order_items', 'order_id')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns actual
    where actual.table_schema = 'public'
      and actual.table_name = required.table_name
      and actual.column_name = required.column_name
  );

  if v_missing_columns is not null then
    raise exception 'Required pre-migration columns are missing: %', v_missing_columns;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'morfi_businesses'
      and column_name = 'payment_method'
      and data_type = 'ARRAY'
      and udt_name = '_text'
  ) then
    raise exception 'public.morfi_businesses.payment_method must be text[]';
  end if;

  if has_column_privilege('anon', 'public.morfi_businesses', 'bank_name', 'SELECT')
    or has_column_privilege('anon', 'public.morfi_businesses', 'transfer_alias', 'SELECT')
    or has_column_privilege('anon', 'public.morfi_businesses', 'transfer_holder', 'SELECT')
    or has_column_privilege('authenticated', 'public.morfi_businesses', 'bank_name', 'SELECT')
    or has_column_privilege('authenticated', 'public.morfi_businesses', 'transfer_alias', 'SELECT')
    or has_column_privilege('authenticated', 'public.morfi_businesses', 'transfer_holder', 'SELECT')
  then
    raise exception 'Bank details must not be directly selectable; expose them only through authorized public/private RPCs';
  end if;

  if to_regprocedure('public.morfi_public_business_contact(uuid)') is null
    or to_regprocedure('public.morfi_public_business_payment_details(uuid)') is null
    or not has_function_privilege(
      'anon', to_regprocedure('public.morfi_public_business_contact(uuid)'), 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', to_regprocedure('public.morfi_public_business_contact(uuid)'), 'EXECUTE'
    )
    or not has_function_privilege(
      'anon', to_regprocedure('public.morfi_public_business_payment_details(uuid)'), 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', to_regprocedure('public.morfi_public_business_payment_details(uuid)'), 'EXECUTE'
    )
  then
    raise exception 'Public business contact and transfer-details RPCs are required for checkout';
  end if;

  if exists (
    select 1
    from pg_proc function_row
    where function_row.oid in (
      to_regprocedure('public.morfi_public_business_contact(uuid)'),
      to_regprocedure('public.morfi_public_business_payment_details(uuid)')
    )
      and not function_row.prosecdef
  ) or exists (
    select 1
    from pg_proc function_row
    cross join lateral aclexplode(
      coalesce(function_row.proacl, acldefault('f', function_row.proowner))
    ) privilege
    where function_row.oid in (
      to_regprocedure('public.morfi_public_business_contact(uuid)'),
      to_regprocedure('public.morfi_public_business_payment_details(uuid)')
    )
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Business contact and transfer-details RPCs must be SECURITY DEFINER and not executable by PUBLIC';
  end if;
  if to_regtype('public.morfi_workspace_role') is null
    or to_regtype('public.morfi_order_status') is null
  then
    raise exception 'Required MORFI role or order status types are missing';
  end if;

  if exists (
    select required.enum_label
    from (values ('on_the_way'), ('delivered')) as required(enum_label)
    where not exists (
      select 1
      from pg_enum enum_row
      join pg_type type_row on type_row.oid = enum_row.enumtypid
      join pg_namespace namespace_row on namespace_row.oid = type_row.typnamespace
      where namespace_row.nspname = 'public'
        and type_row.typname = 'morfi_order_status'
        and enum_row.enumlabel::text = required.enum_label
    )
  ) then
    raise exception 'The order status type must include on_the_way and delivered';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'morfi_orders_customer_snapshot'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'Apply the existing customer snapshot migration before this migration';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.morfi_orders'::regclass
      and conname = 'morfi_orders_payment_status_valid'
  ) then
    raise exception 'The current payment status constraint is required before this migration';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_orders'::regclass
      and tgname = 'morfi_orders_updated_at'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'The current order updated_at trigger is required before this migration';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.morfi_businesses'::regclass
      and tgname = 'morfi_businesses_updated_at'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'The current business updated_at trigger is required before this migration';
  end if;

  if exists (
    select 1
    from public.morfi_orders
    where payment_status is null
      or payment_status not in (
      'not_applicable',
      'awaiting_collection',
      'pending_verification',
      'verified',
      'rejected',
      'awaiting_delivery_quote'
    )
  ) then
    raise exception 'Existing payment_status values need review before extending the constraint';
  end if;
end
$$;

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
grant select (payment_method)
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

-- Pending delivery quotes keep cash unpaid and prevent transfer verification.
alter table public.morfi_orders
  drop constraint if exists morfi_orders_payment_status_valid;

alter table public.morfi_orders
  add constraint morfi_orders_payment_status_valid
  check (payment_status in (
    'not_applicable',
    'awaiting_collection',
    'awaiting_delivery_quote',
    'pending_verification',
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
          (payment_method = 'transfer' and payment_status = 'awaiting_delivery_quote')
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
      if nullif(btrim(v_business.bank_name), '') is null
        or nullif(btrim(v_business.transfer_alias), '') is null
        or nullif(btrim(v_business.transfer_holder), '') is null
      then
        raise exception 'Bank, transfer alias, and account holder must be configured for transfer payments';
      end if;
      new.transfer_bank_snapshot := v_business.bank_name;
      new.transfer_alias_snapshot := v_business.transfer_alias;
      new.transfer_holder_snapshot := v_business.transfer_holder;
    end if;
    if new.delivery_fee_status = 'pending' then
      new.payment_status := case
        when new.payment_method = 'transfer' then 'awaiting_delivery_quote'
        else 'awaiting_collection'
      end;
    elsif new.payment_method = 'transfer' then
      new.payment_status := 'pending_verification';
    end if;
    return new;
  end if;

  if new.delivery_fee_status = 'pending' then
    new.delivery_fee := null;
    new.total := null;
    new.payment_status := case
      when new.payment_method = 'transfer' then 'awaiting_delivery_quote'
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
        when new.payment_method = 'transfer' then 'pending_verification'
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
        when new.payment_method = 'transfer' then 'pending_verification'
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

notify pgrst, 'reload schema';

commit;
