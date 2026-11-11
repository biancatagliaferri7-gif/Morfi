import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sellerFixture, buyer, stranger } from "./helpers/sellerFixture";
import {
  isAllowedPushEndpoint,
  constantTimeEqual,
} from "../supabase/functions/order-push/validation";
const sid = "33333333-3333-4333-8333-333333333333";
const device = "44444444-4444-4444-8444-444444444444";
test("push endpoints cannot target private hosts or user-controlled origins", () => {
  assert.equal(
    isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/123"),
    true,
  );
  for (const u of [
    "http://fcm.googleapis.com/x",
    "https://127.0.0.1/x",
    "https://web.push.apple.com.evil.test/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://my-site.test/push",
  ])
    assert.equal(isAllowedPushEndpoint(u), false, u);
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});
test("push outbox is transactional, private, leased and revokes expired endpoints", async () => {
  const db = await sellerFixture();
  try {
    await db.exec(
      `create role service_role;create table auth.sessions(id uuid,user_id uuid);create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true)) $$;`,
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261111195426_seller_setup_and_hours.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261111200951_order_push_notifications.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query(`insert into auth.sessions values($1,$2)`, [sid, buyer]);
    const b = await db.query<{ id: string }>(
      `insert into public.morfi_businesses(created_by,name,is_open,is_published) values($1,'Prueba',true,true) returning id`,
      [buyer],
    );
    const business = b.rows[0].id;
    await db.query(
      `insert into public.morfi_business_memberships values($1,$2,'owner')`,
      [business, buyer],
    );
    await db.query(
      `select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)`,
      [buyer, sid],
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query(
        `select public.morfi_register_push($1,'https://127.0.0.1/x',$2,$3)`,
        [device, "A".repeat(87), "B".repeat(22)],
      ),
      /Invalid/,
    );
    await db.query(`select public.morfi_register_push($1,$2,$3,$4)`, [
      device,
      "https://fcm.googleapis.com/send/123",
      "A".repeat(87),
      "B".repeat(22),
    ]);
    await assert.rejects(
      db.query("select endpoint from public.morfi_push_subscriptions"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from public.morfi_claim_push_deliveries()"),
      /permission denied/,
    );
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      stranger,
    ]);
    assert.equal(
      (await db.query("select enabled from public.morfi_push_subscriptions"))
        .rows.length,
      0,
    );
    await db.exec("reset role");
    await db.exec("begin");
    await db.query(
      "insert into public.morfi_orders(business_id,order_number) values($1,1)",
      [business],
    );
    await db.exec("rollback");
    assert.equal(
      (await db.query("select * from public.morfi_order_push_events")).rows
        .length,
      0,
    );
    await db.query(
      "insert into public.morfi_orders(business_id,order_number) values($1,2)",
      [business],
    );
    await db.exec("set role service_role");
    const claimed = await db.query<{
      event_id: string;
      subscription_id: string;
      lease_id: string;
    }>("select * from public.morfi_claim_push_deliveries()");
    assert.equal(claimed.rows.length, 1);
    assert.equal(
      (await db.query("select * from public.morfi_claim_push_deliveries()"))
        .rows.length,
      0,
    );
    const d = claimed.rows[0];
    await db.query(
      "select public.morfi_finish_push_delivery($1,$2,$3,'gone','push_http_410')",
      [d.event_id, d.subscription_id, d.lease_id],
    );
    await db.exec("reset role");
    const sub = await db.query<{ enabled: boolean }>(
      "select enabled from public.morfi_push_subscriptions",
    );
    assert.equal(sub.rows[0].enabled, false);
  } finally {
    await db.close();
  }
});
