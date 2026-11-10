import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const buyer = '11111111-1111-4111-8111-111111111111';
const vendor = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const business = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const order = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('order history migration restores existing orders and isolates participants', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
      create type public.morfi_order_status as enum ('pending', 'accepted');
      create table public.morfi_profiles (id uuid primary key);
      create table public.morfi_business_memberships (business_id uuid, user_id uuid);
      create table public.morfi_orders (
        id uuid primary key, customer_id uuid not null, business_id uuid not null,
        status public.morfi_order_status not null, status_reason text,
        created_at timestamptz not null default now()
      );
      create function public.morfi_has_business_access(uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.morfi_business_memberships
          where business_id = $1 and user_id = auth.uid())
      $$;
      grant execute on function public.morfi_has_business_access(uuid) to authenticated;
      grant select on public.morfi_orders to authenticated;
      alter table public.morfi_orders enable row level security;
      create policy order_participants on public.morfi_orders for select to authenticated
        using (customer_id = auth.uid() or public.morfi_has_business_access(business_id));
    `);
    await db.query(`insert into public.morfi_profiles (id) values ($1),($2)`, [buyer, vendor]);
    await db.query(`insert into public.morfi_business_memberships values ($1,$2)`, [business, vendor]);
    await db.query(`insert into public.morfi_orders (id, customer_id, business_id, status)
      values ($1,$2,$3,'pending')`, [order, buyer, business]);

    const migration = await readFile(new URL('../morfi_order_history_incremental.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const historyCount = await db.query<{ count: string }>(
      'select count(*)::text as count from public.morfi_order_status_history where order_id=$1', [order],
    );
    assert.equal(historyCount.rows[0].count, '1');

    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.morfi_order_status_history'), /permission denied/);
    await db.exec('set role authenticated');
    for (const [user, expected] of [[buyer, 1], [vendor, 1], [outsider, 0]] as const) {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
      const rows = await db.query('select order_id from public.morfi_order_status_history');
      assert.equal(rows.rows.length, expected);
    }
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`update public.morfi_orders set status='accepted' where id=$1`, [order]);
    const updated = await db.query<{ status: string }>(
      'select status from public.morfi_order_status_history where order_id=$1 order by created_at, id', [order],
    );
    assert.equal(updated.rows.length, 2);
    assert.ok(updated.rows.some(row => row.status === 'accepted'));
  } finally {
    await db.close();
  }
});
