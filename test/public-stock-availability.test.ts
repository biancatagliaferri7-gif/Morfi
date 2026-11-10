import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('public availability hides private stock and unpublished products', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create table public.morfi_businesses (id uuid primary key, is_published boolean not null);
      create table public.morfi_recipes (id uuid primary key, business_id uuid not null, finished_stock numeric not null);
      create table public.morfi_business_products (
        id uuid primary key, business_id uuid not null, recipe_id uuid,
        stock_quantity integer not null, is_available boolean not null
      );
      alter table public.morfi_businesses enable row level security;
      alter table public.morfi_recipes enable row level security;
      alter table public.morfi_business_products enable row level security;
      insert into public.morfi_businesses values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
      insert into public.morfi_recipes values
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2);
      insert into public.morfi_business_products values
        ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 0, true),
        ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 0, true),
        ('33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 10, true),
        ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 10, false);
    `);
    const migration = await readFile(new URL('../morfi_public_product_availability_incremental.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec('set role anon');
    const result = await db.query<{ product_id: string; in_stock: boolean }>(
      'select * from public.morfi_public_product_availability() order by product_id',
    );
    assert.deepEqual(result.rows, [
      { product_id: '11111111-1111-4111-8111-111111111111', in_stock: false },
      { product_id: '22222222-2222-4222-8222-222222222222', in_stock: true },
    ]);
    await assert.rejects(db.query('select stock_quantity from public.morfi_business_products'), /permission denied/);
  } finally {
    await db.close();
  }
});
