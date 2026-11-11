// Explicit opt-in only: creates disposable demo records in the named project.
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
if (!process.argv.includes("--allow-demo-writes"))
  throw new Error(
    "Pass --allow-demo-writes only with authorization for this project.",
  );
const ref = process.argv[process.argv.indexOf("--project-ref") + 1];
if (
  !ref ||
  !process.env.VITE_SUPABASE_URL ||
  new URL(process.env.VITE_SUPABASE_URL).hostname !== ref + ".supabase.co"
)
  throw new Error("Project reference and URL must match explicitly.");
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!key) throw new Error("Missing public project key");
const client = () =>
  createClient(process.env.VITE_SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const check = async (promise) => {
  const r = await promise;
  if (r.error) throw new Error(r.error.code + ": " + r.error.message);
  return r.data;
};
const seller = client(),
  buyer = client(),
  resumed = client(),
  anon = client();
const suffix = Date.now();
const password = "Demo!" + randomBytes(24).toString("base64url");
let businessId, branchId, orderId;
const report = { project: ref, at: new Date().toISOString(), checks: [] };
const passed = (name) => {
  report.checks.push(name);
  console.log("OK " + name);
};
try {
  const sellerEmail = "morfi-demo-seller-" + suffix + "@example.com";
  const account = await check(
    seller.auth.signUp({
      email: sellerEmail,
      password,
      options: {
        data: {
          full_name: "MORFI Demo técnica",
          enabled_panels: ["cliente"],
          business_setup_deferred: true,
        },
      },
    }),
  );
  assert.ok(
    account.session,
    "Email confirmation is still required; stop and inspect Auth configuration.",
  );
  report.sellerUserId = account.user.id;
  const dni = String(10000000 + Math.floor(Math.random() * 80000000));
  await check(
    seller.rpc("morfi_save_seller_identity", {
      p_name: "MORFI Demo técnica",
      p_dni: dni,
      p_phone: "+5493804000000",
    }),
  );
  const draft = await check(
    seller.rpc("morfi_get_seller_draft", { p_parent_business_id: null }),
  );
  const data = {
    name: "DEMO técnica " + suffix,
    description: "Prueba autorizada. No recibe pedidos reales.",
    location: "Punto de prueba, La Rioja",
    latitude: -29.413,
    longitude: -66.855,
    phone: "+5493804000000",
    accepts_transfer: false,
    accepts_delivery: true,
    hours: [
      { weekday: 1, slot: 0, opens: "12:00", closes: "15:00" },
      { weekday: 1, slot: 1, opens: "20:00", closes: "02:00" },
    ],
  };
  await check(
    seller.rpc("morfi_save_seller_draft", {
      p_draft_id: draft.id,
      p_data: data,
      p_step: 4,
    }),
  );
  await check(
    resumed.auth.signInWithPassword({ email: sellerEmail, password }),
  );
  const restored = await check(
    resumed.rpc("morfi_get_seller_draft", { p_parent_business_id: null }),
  );
  assert.equal(restored.id, draft.id);
  assert.equal(restored.data.name, data.name);
  passed("draft resumes in another session");
  businessId = await check(
    seller.rpc("morfi_complete_seller_setup", { p_draft_id: draft.id }),
  );
  assert.equal(
    await check(
      seller.rpc("morfi_complete_seller_setup", { p_draft_id: draft.id }),
    ),
    businessId,
  );
  passed("completion is idempotent");
  report.businessId = businessId;
  const buyerAccount = await check(
    buyer.auth.signUp({
      email: "morfi-demo-buyer-" + suffix + "@example.com",
      password,
      options: {
        data: {
          full_name: "Cliente demo técnica",
          enabled_panels: ["cliente"],
        },
      },
    }),
  );
  assert.ok(buyerAccount.session);
  report.buyerUserId = buyerAccount.user.id;
  assert.equal(
    (
      await check(
        buyer.from("morfi_seller_setup_drafts").select("id").eq("id", draft.id),
      )
    ).length,
    0,
  );
  const foreign = await buyer.rpc("morfi_managed_availability", {
    p_business_id: businessId,
  });
  assert.ok(foreign.error);
  passed("buyer cannot read seller draft or managed availability");
  const product = await check(
    seller
      .from("morfi_business_products")
      .insert({
        business_id: businessId,
        name: "Producto DEMO técnica",
        description: "Prueba sin venta real",
        price: 100,
        stock_quantity: 0,
        is_available: true,
        accepts_delivery: true,
        payment_methods: ["cash"],
      })
      .select("id")
      .single(),
  );
  await check(
    seller
      .from("morfi_businesses")
      .update({ is_published: true })
      .eq("id", businessId),
  );
  await check(
    seller.rpc("morfi_set_order_reception", {
      p_business_id: businessId,
      p_action: "open",
    }),
  );
  const publicState = await check(
    anon.rpc("morfi_public_business_availability", { p_ids: [businessId] }),
  );
  assert.equal(publicState[0].is_open, true);
  const input = {
    p_business_id: businessId,
    p_customer_phone: "+5493804000001",
    p_items: [
      {
        product_id: product.id,
        quantity: 2,
        customer_notes: "Observación demo",
      },
    ],
    p_delivery_mode: "pickup",
    p_delivery_address: null,
    p_delivery_references: null,
    p_payment_method: "cash",
    p_customer_notes: "Prueba técnica autorizada",
    p_request_key: randomUUID(),
  };
  const created = await check(buyer.rpc("morfi_create_order_v2", input));
  orderId = created[0].order_id;
  report.orderId = orderId;
  report.orderNumber = created[0].order_number;
  assert.equal(
    (await check(buyer.rpc("morfi_create_order_v2", input)))[0].order_id,
    orderId,
  );
  const own = await check(
    resumed
      .from("morfi_orders")
      .select("id,total,status")
      .eq("id", orderId)
      .single(),
  );
  assert.equal(Number(own.total), 200);
  passed(
    "zero-stock checkout is idempotent and visible to seller second session",
  );
  await check(
    seller.rpc("morfi_set_order_reception", {
      p_business_id: businessId,
      p_action: "pause",
    }),
  );
  const paused = await buyer.rpc("morfi_create_order_v2", {
    ...input,
    p_request_key: randomUUID(),
  });
  assert.ok(paused.error);
  passed("server rejects checkout during manual pause");
  const branchDraft = await check(
    seller.rpc("morfi_get_seller_draft", { p_parent_business_id: businessId }),
  );
  await check(
    seller.rpc("morfi_save_seller_draft", {
      p_draft_id: branchDraft.id,
      p_data: { ...data, name: data.name + " sucursal" },
      p_step: 4,
    }),
  );
  branchId = await check(
    seller.rpc("morfi_complete_seller_setup", { p_draft_id: branchDraft.id }),
  );
  assert.notEqual(branchId, businessId);
  report.branchId = branchId;
  assert.equal(
    (
      await check(
        seller
          .from("morfi_business_products")
          .select("id")
          .eq("business_id", branchId),
      )
    ).length,
    0,
  );
  passed("branch has independent empty catalog");
  await check(
    seller.rpc("morfi_update_order_status_with_reason", {
      p_order_id: orderId,
      p_new_status: "rejected",
      p_reason: "Fin de prueba técnica autorizada",
    }),
  );
  assert.equal(
    (
      await check(
        buyer
          .from("morfi_order_status_history")
          .select("status")
          .eq("order_id", orderId),
      )
    ).some((h) => h.status === "rejected"),
    true,
  );
  assert.equal(
    (
      await check(
        seller
          .from("morfi_business_products")
          .select("stock_quantity")
          .eq("id", product.id)
          .single(),
      )
    ).stock_quantity,
    0,
  );
  passed("rejection keeps stock zero and history visible to buyer");
} finally {
  if (businessId) {
    const hidden = await seller
      .from("morfi_businesses")
      .update({ is_published: false })
      .eq("id", businessId);
    report.demoHidden = !hidden.error;
  }
  await Promise.allSettled([
    seller.auth.signOut(),
    buyer.auth.signOut(),
    resumed.auth.signOut(),
  ]);
  await mkdir(".morfi-evidence.local", { recursive: true });
  await writeFile(
    ".morfi-evidence.local/demo-release.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "Evidence saved in .morfi-evidence.local/demo-release.json; no passwords or tokens recorded.",
  );
}
