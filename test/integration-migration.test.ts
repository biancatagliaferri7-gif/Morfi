import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const business = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Minimal schema for the contracts this migration consumes. This intentionally
// does not claim to validate Supabase Auth, Storage or the complete checkout.
const fixture = `
  create role anon;
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  create type public.morfi_workspace_role as enum ('owner', 'manager', 'staff');
  create table public.morfi_businesses (
    id uuid primary key default gen_random_uuid(), created_by uuid not null,
    name text, description text, location text,
    is_open boolean default false, accepts_delivery boolean default false,
    accepts_pickup boolean default true, delivery_fee numeric default 0,
    delivery_fee_status text default 'pending', payment_methods text[] default array['cash'],
    contact_phone text, phone_is_public boolean default false, bank_name text,
    bank_cuit text, transfer_alias text, transfer_holder text
  );
  create table public.morfi_business_memberships (
    business_id uuid, user_id uuid, role public.morfi_workspace_role
  );
  create function public.morfi_has_business_access(uuid, public.morfi_workspace_role[])
    returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.morfi_business_memberships
      where business_id = $1 and user_id = auth.uid() and role = any($2))
  $$;
  create table public.morfi_business_products (
    id uuid default gen_random_uuid(), business_id uuid,
    stock_quantity integer default 0 check (stock_quantity >= 0)
  );
  alter table public.morfi_business_products enable row level security;
  grant select on public.morfi_business_products to authenticated;
  create policy product_members on public.morfi_business_products for all to authenticated
    using (public.morfi_has_business_access(business_id, array['owner','manager','staff']::public.morfi_workspace_role[]))
    with check (public.morfi_has_business_access(business_id, array['owner','manager','staff']::public.morfi_workspace_role[]));
  create table auth.users (id uuid, raw_user_meta_data jsonb);
  create function public.morfi_create_business_from_signup() returns trigger
    language plpgsql as $$ begin return new; end $$;
  create trigger signup_business after insert on auth.users
    for each row execute function public.morfi_create_business_from_signup();
`;

test('Bianca integration migration preserves privacy, stock ownership and both signup paths', async t => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    const migration = await readFile(new URL('../morfi_reconciliation_migration.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Safe to re-run after an interrupted deployment.
    await db.query(`insert into public.morfi_businesses (id, created_by, name, bank_name, transfer_alias) values ($1, $2, 'Comercio de prueba', 'Banco', 'alias.privado')`, [business, owner]);
    await db.query(`insert into public.morfi_business_memberships values ($1, $2, 'owner')`, [business, owner]);
    await db.query(`insert into public.morfi_business_products (business_id, stock_quantity) values ($1, 5)`, [business]);

    await t.test('only the owner/manager can read private settings', async () => {
      await db.exec('set role anon');
      await assert.rejects(db.query('select * from public.morfi_managed_business_settings($1)', [business]), /permission denied/);
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [other]);
      await assert.rejects(db.query('select * from public.morfi_managed_business_settings($1)', [business]), /owner or manager/);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [owner]);
      const result = await db.query<{ transfer_alias: string }>('select * from public.morfi_managed_business_settings($1)', [business]);
      assert.equal(result.rows[0].transfer_alias, 'alias.privado');
      await assert.rejects(db.query('select bank_name from public.morfi_businesses'), /permission denied/);
      await db.exec('reset role');
    });

    await t.test('stock editing stays isolated to the business membership', async () => {
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [other]);
      const foreign = await db.query('update public.morfi_business_products set stock_quantity = 99 returning stock_quantity');
      assert.equal(foreign.rows.length, 0);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [owner]);
      const own = await db.query<{ stock_quantity: number }>('update public.morfi_business_products set stock_quantity = 8 returning stock_quantity');
      assert.equal(own.rows[0].stock_quantity, 8);
      await assert.rejects(db.query('update public.morfi_business_products set stock_quantity = -1'), /check constraint/);
      await db.exec('reset role');
    });

    await t.test('lightweight signup defers the business without rejecting the account', async () => {
      await db.query('insert into auth.users values ($1, $2)', [other, { enabled_panels: ['cliente', 'emprendimiento'], business_setup_deferred: true }]);
      const result = await db.query('select * from public.morfi_businesses where created_by = $1', [other]);
      assert.equal(result.rows.length, 0);
    });

    await t.test('full signup keeps Bianca bank data and selected payment methods', async () => {
      await db.query('insert into auth.users values ($1, $2)', [other, {
        enabled_panels: ['cliente', 'emprendimiento'], business_name: 'Nuevo comercio',
        business_location: 'La Rioja', phone: '+5493804000000',
        business_payment_methods: ['transfer'], business_bank_name: 'Banco',
        business_bank_cuit: '20123456789', business_transfer_alias: 'comercio.alias',
        business_transfer_holder: 'Titular',
      }]);
      const result = await db.query<{ payment_methods: string[]; transfer_alias: string }>('select payment_methods, transfer_alias from public.morfi_businesses where created_by = $1', [other]);
      assert.deepEqual(result.rows[0].payment_methods, ['transfer']);
      assert.equal(result.rows[0].transfer_alias, 'comercio.alias');
      await assert.rejects(db.query('insert into auth.users values ($1, $2)', [other, { enabled_panels: ['emprendimiento'] }]), /business name/);
    });
  } finally {
    await db.close();
  }
});
