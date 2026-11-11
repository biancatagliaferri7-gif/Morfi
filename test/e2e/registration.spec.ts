import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const userId = "11111111-1111-4111-8111-111111111111";
const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draftId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const user = {
  id: userId,
  email: "prueba@example.invalid",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Persona de prueba" },
};
const token =
  btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
  "." +
  btoa(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: "authenticated",
    }),
  ) +
  ".fixture";
const session = {
  access_token: token,
  refresh_token: "fixture-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
};
async function fixture(
  page: Page,
  {
    signed = false,
    resume = false,
    lostReply = false,
    sellerAccount = false,
    identityRejected = false,
  } = {},
) {
  let seller = sellerAccount;
  let logoutScope = "";
  let draftStarted = resume;
  let draftLoads = 0;
  let identityDone = signed;
  let reception = sellerAccount ? "open" : "unpublished";
  let completions = 0;
  let products: any[] = [];
  let draft: any = {
    id: draftId,
    step: resume ? 3 : 2,
    parent_business_id: null,
    result_business_id: null,
    data: resume
      ? {
          name: "Viandas del barrio",
          location: "Calle 123",
          latitude: -29.4,
          longitude: -66.8,
          phone: "+5493804000000",
          hours: [],
        }
      : {},
  };
  const saves: any[] = [];
  if (signed)
    await page.addInitScript(
      (s) =>
        localStorage.setItem("sb-morfi-test-auth-token", JSON.stringify(s)),
      session,
    );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: (_s: any, f: any) => f({ code: 1 }) },
    });
  });
  await page.route("https://morfi-test.invalid/**", async (route) => {
    const url = new URL(route.request().url());
    let body: any = [];
    const payload = route.request().postDataJSON();
    if (url.pathname.startsWith("/auth/v1/signup")) body = { ...session, user };
    else if (url.pathname === "/auth/v1/token") body = session;
    else if (url.pathname === "/auth/v1/user") body = user;
    else if (url.pathname === "/auth/v1/logout") {
      logoutScope = url.searchParams.get("scope") ?? "";
      body = {};
    } else if (url.pathname.includes("morfi_profiles"))
      body = {
        id: userId,
        full_name: "Persona de prueba",
        dni: identityDone ? "12345678" : null,
        phone: identityDone ? "+5493804000000" : null,
        enabled_panels: seller ? ["cliente", "emprendimiento"] : ["cliente"],
      };
    else if (url.pathname.includes("/rpc/morfi_get_seller_draft")) {
      draftStarted = true;
      draftLoads++;
      draft.parent_business_id = payload.p_parent_business_id;
      body = draft;
    } else if (url.pathname.includes("/rpc/morfi_save_seller_identity")) {
      if (identityRejected) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "23505",
            message: "DNI already exists",
          }),
        });
        return;
      }
      identityDone = true;
      body = null;
    } else if (url.pathname.includes("/rpc/morfi_save_seller_draft")) {
      saves.push(payload.p_data);
      draft = { ...draft, data: payload.p_data, step: payload.p_step };
      body = null;
    } else if (url.pathname.includes("/rpc/morfi_complete_seller_setup")) {
      seller = true;
      completions++;
      draft.result_business_id = businessId;
      if (lostReply) {
        await route.abort();
        return;
      }
      body = businessId;
    } else if (url.pathname.includes("morfi_seller_setup_drafts"))
      body = url.searchParams.has("id")
        ? draft
        : draftStarted && !draft.result_business_id && !draft.parent_business_id
          ? [{ id: draft.id }]
          : [];
    else if (url.pathname.includes("morfi_business_memberships"))
      body = seller ? [{ business_id: businessId, role: "owner" }] : [];
    else if (url.pathname.includes("/rpc/morfi_set_order_reception")) {
      reception =
        payload.p_action === "pause"
          ? "paused"
          : payload.p_action === "open"
            ? "exceptional"
            : "open";
      body = null;
    } else if (url.pathname.includes("/rpc/morfi_managed_availability"))
      body = [
        {
          state: reception,
          is_open: reception === "open" || reception === "exceptional",
          next_open_at: null,
          override_until: null,
        },
      ];
    else if (url.pathname.includes("/rpc/morfi_managed_business_settings"))
      body = [
        {
          is_open: true,
          accepts_pickup: true,
          accepts_delivery: false,
          delivery_fee: 0,
          delivery_fee_status: "pending",
          payment_method: ["cash"],
          contact_phone: "+5493804000000",
          phone_is_public: true,
        },
      ];
    else if (url.pathname.endsWith("/morfi_business_products")) {
      if (route.request().method() === "POST") {
        const row = {
          ...payload,
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          recipe_id: null,
        };
        products.push(row);
        body = row;
      } else body = products;
    } else if (url.pathname.endsWith("/morfi_businesses")) {
      if (route.request().method() === "PATCH") {
        if (payload.is_published) reception = "open";
        body = { id: businessId };
      } else
        body = [
          {
            id: businessId,
            name: "Viandas del barrio",
            description: "",
            location: "Calle 123",
            latitude: -29.4,
            longitude: -66.8,
            logo_path: null,
            is_published: reception !== "unpublished",
            phone_is_public: true,
          },
        ];
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  return {
    saves,
    get draftLoads() {
      return draftLoads;
    },
    get logoutScope() {
      return logoutScope;
    },
    get completions() {
      return completions;
    },
    get draft() {
      return draft;
    },
  };
}
test("client signup links at the foot to a separate four-step seller form", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Registrate para pedir" }),
  ).toBeVisible();
  await expect(page.getByLabel("DNI N°")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Mi emprendimiento" }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Registrate como emprendedor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tus datos", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Nombre y apellido", { exact: true })
    .fill("Persona de prueba");
  await page.getByLabel("DNI N°").fill("12345678");
  await page
    .getByLabel("WhatsApp público donde recibirás pedidos")
    .fill("3804000000");
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill("prueba@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("ClaveDePrueba123!");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tu emprendimiento", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Nombre del emprendimiento", { exact: true })
    .fill("Viandas del barrio");
  await page.getByLabel("Dirección del punto de venta").fill("Calle 123");
  await page.getByRole("button", { name: "Usar mi ubicación" }).click();
  await expect(
    page.getByText("No se pudo obtener el GPS. Marcá el punto en el mapa."),
  ).toBeVisible();
  await page.getByText("Ingresar coordenadas con teclado").click();
  await page.getByLabel("Latitud", { exact: true }).fill("-29.4");
  await page.getByLabel("Longitud", { exact: true }).fill("-66.8");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tus horarios", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Lunes", exact: true })
    .getByLabel("Atiendo este día")
    .check();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Cómo cobrás y entregás" }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: ".morfi-evidence.local/seller-step-four.png",
    fullPage: true,
  });
  await page
    .getByLabel("¿Aceptás pago con transferencia?")
    .selectOption("true");
  await page
    .getByRole("combobox", { name: "Banco o billetera", exact: true })
    .selectOption("Otro");
  await page.getByLabel("Nombre del banco o billetera").fill("Banco de prueba");
  await page.getByLabel("Alias", { exact: true }).fill("prueba.alias");
  await page.getByLabel("Titular de la cuenta").fill("Persona de prueba");
  await page.getByLabel("CUIT/CUIL del titular").fill("20123456789");
  await page
    .getByRole("button", { name: "Terminar registro", exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/business" &&
      url.searchParams.get("business") === businessId,
  );
  await expect(
    page.getByRole("button", { name: "Mis productos", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "¿Qué vendés?", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Registrar un emprendimiento", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    return new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
  });
  await page.screenshot({
    path: ".morfi-evidence.local/seller-panel.png",
    fullPage: true,
  });
  await page
    .getByLabel("Nombre del producto", { exact: true })
    .fill("Empanadas de prueba");
  await page.getByLabel("Precio en pesos", { exact: true }).fill("1000");
  await page
    .getByRole("button", { name: "+ Guardar producto", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Publicar mi comercio", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Publicar mi comercio", exact: true })
    .click();
  await expect(
    page.getByText("Recibiendo pedidos", { exact: true }),
  ).toBeVisible();
  expect(f.completions).toBe(1);
  expect(JSON.stringify(f.saves)).not.toContain("ClaveDePrueba");
});
test("reload resumes private draft; a lost completion reply does not create another business", async ({
  page,
}) => {
  const f = await fixture(page, {
    signed: true,
    resume: true,
    lostReply: true,
  });
  await page.goto("/register/emprendedor");
  await expect(
    page.getByRole("heading", { name: "Tus horarios", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tus horarios", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Lunes", exact: true })
    .getByLabel("Atiendo este día")
    .check();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByRole("button", { name: "Terminar registro", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/business" &&
      url.searchParams.get("business") === businessId,
  );
  expect(f.completions).toBe(1);
});

test("seller can pause orders and start a branch without repeating personal data", async ({
  page,
}) => {
  await fixture(page, { signed: true, sellerAccount: true });
  await page.goto("/business");
  await expect(
    page.getByRole("button", { name: "Dejar de tomar pedidos", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Dejar de tomar pedidos", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Volver a tomar pedidos", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Volver a tomar pedidos", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Dejar de tomar pedidos", exact: true }),
  ).toBeVisible();
  await page.getByText("Configuración del comercio", { exact: true }).click();
  await page
    .getByRole("link", { name: "Agregar sucursal", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tu emprendimiento", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("DNI N°")).toHaveCount(0);
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("Nombre de esta sucursal", { exact: true }),
  ).toBeVisible();
});

test("sign out clears seller navigation and keeps other devices signed in", async ({
  page,
}) => {
  const f = await fixture(page, { signed: true, sellerAccount: true });
  await page.goto("/business");
  await expect(
    page.getByRole("link", { name: "Mi emprendimiento", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("link", { name: "Mi emprendimiento", exact: true }),
  ).toHaveCount(0);
  expect(f.logoutScope).toBe("local");
});

test("a rejected DNI keeps the created account resumable and recovery is reachable", async ({
  page,
}) => {
  const f = await fixture(page, { identityRejected: true });
  await page.goto("/register/emprendedor");
  await page
    .getByLabel("Nombre y apellido", { exact: true })
    .fill("Persona de prueba");
  await page.getByLabel("DNI N°").fill("12345678");
  await page
    .getByLabel("WhatsApp público donde recibirás pedidos")
    .fill("3804000000");
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill("prueba@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("ClaveDePrueba123!");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Ese DNI ya está asociado",
  );
  expect(f.draftLoads).toBeGreaterThan(0);
  await page
    .getByRole("button", {
      name: "Recuperar el acceso a mi cuenta",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recuperar contraseña", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Nueva contraseña", { exact: true }),
  ).toHaveCount(0);
  expect(f.logoutScope).toBe("local");
  await page.goto("/login");
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill("prueba@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("ClaveDePrueba123!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).toHaveURL(/register\/emprendedor/);
  await expect(
    page.getByRole("heading", { name: "Tus datos", exact: true }),
  ).toBeVisible();
});
