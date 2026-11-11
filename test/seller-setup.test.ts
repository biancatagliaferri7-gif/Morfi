import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sellerFixture, buyer, stranger } from "./helpers/sellerFixture";
const migration = await readFile(
  new URL(
    "../supabase/migrations/20261111195426_seller_setup_and_hours.sql",
    import.meta.url,
  ),
  "utf8",
);
const boundaryMigration=await readFile(new URL('../supabase/migrations/20261111210516_seller_hours_boundary_validation.sql',import.meta.url),'utf8');
const pauseGuardMigration=await readFile(new URL('../supabase/migrations/20261111211140_seller_manual_pause_guard.sql',import.meta.url),'utf8');
const data = {
  name: "Comercio prueba",
  location: "Calle 123, La Rioja",
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
test("seller draft is private, completion is idempotent and branches are independent", async () => {
  const db = await sellerFixture();
  try {
    await db.exec(migration);
    await db.exec(boundaryMigration);
    await db.exec(pauseGuardMigration);
    await db.exec(migration);
    await db.exec(boundaryMigration);
    await db.exec(pauseGuardMigration);
    await db.exec("set role authenticated");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      buyer,
    ]);
    await db.query(
      "select public.morfi_save_seller_identity('Persona Prueba','12345678','+5493804000000')",
    );
    const draft = await db.query<{ id: string }>(
      "select id from public.morfi_get_seller_draft(null)",
    );
    const id = draft.rows[0].id;
    await db.query("select public.morfi_save_seller_draft($1,$2,4)", [
      id,
      data,
    ]);
    const first = await db.query<{ id: string }>(
      "select public.morfi_complete_seller_setup($1) id",
      [id],
    );
    const business = first.rows[0].id;
    const second = await db.query<{ id: string }>(
      "select public.morfi_complete_seller_setup($1) id",
      [id],
    );
    assert.equal(second.rows[0].id, business);
    await assert.rejects(
      db.query("select public.morfi_save_seller_draft($1,$2,4)", [
        id,
        { password: "must-not-be-stored" },
      ]),
      /Unexpected/,
    );
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      stranger,
    ]);
    assert.equal(
      (await db.query("select * from public.morfi_seller_setup_drafts")).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("select public.morfi_complete_seller_setup($1)", [id]),
      /unavailable/,
    );
    await assert.rejects(
      db.query("select public.morfi_get_seller_draft($1)", [business]),
      /owner/,
    );
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      buyer,
    ]);
    const branch = await db.query<{ id: string }>(
      "select id from public.morfi_get_seller_draft($1)",
      [business],
    );
    await db.query("select public.morfi_save_seller_draft($1,$2,4)", [
      branch.rows[0].id,
      { ...data, name: "Sucursal Centro" },
    ]);
    const branchResult = await db.query<{ id: string }>(
      "select public.morfi_complete_seller_setup($1) id",
      [branch.rows[0].id],
    );
    assert.notEqual(branchResult.rows[0].id, business);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from public.morfi_businesses")).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
test("schedule covers overnight, boundaries, overlap rejection and server order guard", async () => {
  const db = await sellerFixture();
  try {
    await db.exec(migration);
    await db.exec(boundaryMigration);
    await db.exec(pauseGuardMigration);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      buyer,
    ]);
    const d = await db.query<{ id: string }>(
      "select id from public.morfi_get_seller_draft(null)",
    );
    await db.query("select public.morfi_save_seller_draft($1,$2,4)", [
      d.rows[0].id,
      data,
    ]);
    const b = await db.query<{ id: string }>(
      "select public.morfi_complete_seller_setup($1) id",
      [d.rows[0].id],
    );
    const id = b.rows[0].id;
    await db.query(
      "update public.morfi_businesses set is_published=true where id=$1",
      [id],
    );
    for (const [at, open] of [
      ["2026-11-09T15:00:00Z", true],
      ["2026-11-09T18:00:00Z", false],
      ["2026-11-10T04:59:00Z", true],
      ["2026-11-10T05:00:00Z", false],
    ] as const) {
      const a = await db.query<{ is_open: boolean }>(
        "select * from morfi_private.availability($1,$2)",
        [id, at],
      );
      assert.equal(a.rows[0].is_open, open, at);
    }
    await assert.rejects(
      db.query("select public.morfi_save_business_hours($1,$2)", [
        id,
        [
          { weekday: 0, slot: 0, opens: "23:00", closes: "02:00" },
          { weekday: 1, slot: 0, opens: "01:00", closes: "03:00" },
        ],
      ]),
      /overlap/,
    );
    await db.query(
      "update public.morfi_businesses set order_override='paused',override_until=now()+interval '1 hour' where id=$1",
      [id],
    );
    await assert.rejects(
      db.query("insert into public.morfi_orders(business_id) values($1)", [id]),
      /unavailable/,
    );
    await assert.rejects(db.query('select public.morfi_save_business_hours($1,$2)',[id,[{weekday:1,slot:0,opens:'24:00',closes:'00:00'}]]),/Invalid opening hours/);
    const history = await db.query(
      "select * from public.morfi_business_hours where business_id=$1",
      [id],
    );
    assert.equal(history.rows.length, 2);
  } finally {
    await db.close();
  }
});

test("manual pauses expire at next slot; exceptional openings expire at next boundary", async () => {
  const db = await sellerFixture();
  try {
    await db.exec(migration);
    await db.exec(boundaryMigration);
    await db.exec(pauseGuardMigration);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      buyer,
    ]);
    const d = await db.query<{ id: string }>(
      "select id from public.morfi_get_seller_draft(null)",
    );
    await db.query("select public.morfi_save_seller_draft($1,$2,4)", [
      d.rows[0].id,
      data,
    ]);
    const b = await db.query<{ id: string }>(
      "select public.morfi_complete_seller_setup($1) id",
      [d.rows[0].id],
    );
    const id = b.rows[0].id;
    await db.query(
      "update public.morfi_businesses set is_published=true,order_override='paused',override_until='2026-11-09T23:00:00Z' where id=$1",
      [id],
    );
    for (const [at, state] of [
      ["2026-11-09T17:00:00Z", "paused"],
      ["2026-11-09T22:59:59Z", "paused"],
      ["2026-11-09T23:00:00Z", "open"],
    ] as const) {
      const a = await db.query<{ state: string }>(
        "select state from morfi_private.availability($1,$2)",
        [id, at],
      );
      assert.equal(a.rows[0].state, state);
    }
    await db.query(
      "update public.morfi_businesses set order_override='open',override_until='2026-11-09T23:00:00Z' where id=$1",
      [id],
    );
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from morfi_private.availability($1,'2026-11-09T22:00:00Z')",
          [id],
        )
      ).rows[0].state,
      "exceptional",
    );
    await db.query("select public.morfi_set_order_reception($1,'resume')", [
      id,
    ]);
    assert.equal(
      (
        await db.query(
          "select order_override from public.morfi_businesses where id=$1",
          [id],
        )
      ).rows[0].order_override,
      null,
    );
    await db.query("select public.morfi_set_order_reception($1,'pause')", [id]);
    const pause = await db.query<{ matches: boolean }>(
      "select override_until=(select min(starts) from morfi_private.hours_windows($1,now()) where starts>now()) matches from public.morfi_businesses where id=$1",
      [id],
    );
    assert.equal(pause.rows[0].matches, true);
    await db.query("select public.morfi_save_business_hours($1,$2)", [
      id,
      [{ weekday: 0, slot: 0, opens: "23:00", closes: "02:00" }],
    ]);
    // Clear the manual exception to inspect the new Sunday-to-Monday weekly slot.
    await db.query("select public.morfi_set_order_reception($1,'resume')", [
      id,
    ]);
    assert.equal(
      (
        await db.query<{ is_open: boolean }>(
          "select is_open from morfi_private.availability($1,'2026-11-16T04:59:59Z')",
          [id],
        )
      ).rows[0].is_open,
      true,
    );
    await assert.rejects(
      db.query(
        "update public.morfi_businesses set payment_methods=array['transfer'] where id=$1",
        [id],
      ),
      /bank/,
    );
    await db.query(
      "update public.morfi_businesses set bank_name='Otro banco',transfer_alias='prueba',transfer_holder='Persona',bank_cuit='20-12345678-9',payment_methods=array['transfer'] where id=$1",
      [id],
    );
    const pay = await db.query<{
      bank_cuit: string;
      payment_methods: string[];
    }>(
      "select bank_cuit,payment_methods from public.morfi_businesses where id=$1",
      [id],
    );
    assert.equal(pay.rows[0].bank_cuit, "20123456789");
    assert.ok(pay.rows[0].payment_methods.includes("cash"));
    await db.query("update public.morfi_businesses set order_override='paused',override_until=now()-interval '1 hour' where id=$1",[id]);
    await db.query('select public.morfi_save_business_hours($1,$2)',[id,data.hours]);
    assert.equal((await db.query('select order_override from public.morfi_businesses where id=$1',[id])).rows[0].order_override,null);
    const legacy=await db.query<{id:string}>("insert into public.morfi_businesses(created_by,name,is_open,is_published) values($1,'Legacy',true,true) returning id",[buyer]);
    await db.query("insert into public.morfi_business_memberships values($1,$2,'owner')",[legacy.rows[0].id,buyer]);
    await db.query("select public.morfi_set_order_reception($1,'pause')",[legacy.rows[0].id]);
    await db.query('update public.morfi_businesses set is_open=true where id=$1',[legacy.rows[0].id]);
    assert.equal((await db.query<{is_open:boolean}>('select is_open from morfi_private.availability($1)',[legacy.rows[0].id])).rows[0].is_open,false);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      stranger,
    ]);
    await assert.rejects(
      db.query("select public.morfi_set_order_reception($1,'open')", [id]),
      /authorized/,
    );
    await assert.rejects(
      db.query(
        "select public.morfi_save_seller_identity('Persona','12345678','+5493804000001')",
      ),
      /unique/,
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select public.morfi_complete_seller_setup($1)", [d.rows[0].id]),
      /permission/,
    );
  } finally {
    await db.close();
  }
});

test("seller field validation accepts local WhatsApp and conditional transfer details", async () => {
  const { normalizePhone, validateSetupStep } =
    await import("../src/business/sellerValidation");
  const emptySetup = {
    ...data,
    description: "",
    bank_name: "",
    bank_cuit: "",
    transfer_alias: "",
    transfer_holder: "",
  };
  assert.equal(normalizePhone("3804000000"), "+5493804000000");
  assert.equal(normalizePhone("+5493804000000"), "+5493804000000");
  assert.equal(normalizePhone("123"), "");
  assert.ok(
    validateSetupStep(
      {
        ...emptySetup,
        name: "Prueba",
        location: "Calle",
        latitude: 100,
        longitude: 0,
      },
      2,
    ),
  );
  assert.ok(
    validateSetupStep(
      {
        ...emptySetup,
        name: "Prueba",
        location: "Calle",
        latitude: NaN,
        longitude: 0,
      },
      2,
    ),
  );
  assert.equal(
    validateSetupStep(
      { ...emptySetup, phone: "+5493804000000", accepts_transfer: false },
      4,
    ),
    "",
  );
  assert.ok(
    validateSetupStep(
      { ...emptySetup, phone: "+5493804000000", accepts_transfer: true },
      4,
    ),
  );
  assert.equal(
    validateSetupStep(
      {
        ...emptySetup,
        phone: "+5493804000000",
        accepts_transfer: true,
        bank_name: "Otro banco",
        bank_cuit: "20-12345678-9",
        transfer_alias: "prueba",
        transfer_holder: "Persona",
      },
      4,
    ),
    "",
  );
});

test("registration return paths stay inside MORFI", async () => {
  const { safeReturnPath } = await import("../src/auth/returnPath");
  assert.equal(
    safeReturnPath("/hungry?checkout=1", "/account"),
    "/hungry?checkout=1",
  );
  for (const path of [
    "https://elsewhere.invalid",
    "//elsewhere.invalid",
    "/\\elsewhere.invalid",
    "/\\[",
    null,
  ])
    assert.equal(safeReturnPath(path, "/account"), "/account");
});
