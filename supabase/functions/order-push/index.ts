import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { ApplicationServer, Urgency } from "jsr:@negrel/webpush@0.5.0";
import { isAllowedPushEndpoint, constantTimeEqual } from "./validation.ts";
const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("Missing server configuration: " + name);
  return value;
};
Deno.serve(async (request) => {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const expected = Deno.env.get("MORFI_PUSH_WORKER_SECRET");
  if (
    !expected ||
    !constantTimeEqual(
      request.headers.get("x-morfi-worker-secret") ?? "",
      expected,
    )
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    const db = createClient(
      env("SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    const jwk = JSON.parse(env("VAPID_PRIVATE_JWK"));
    const publicJwk = { ...jwk, key_ops: ["verify"] };
    delete publicJwk.d;
    const vapidKeys = {
      privateKey: await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      ),
      publicKey: await crypto.subtle.importKey(
        "jwk",
        publicJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      ),
    };
    const server = await ApplicationServer.new({
      vapidKeys,
      contactInformation: env("VAPID_SUBJECT"),
    });
    const claimed = await db.rpc("morfi_claim_push_deliveries");
    if (claimed.error)
      throw new Error("Unable to claim notification deliveries");
    let sent = 0;
    for (const delivery of claimed.data ?? []) {
      let result = "sent";
      let errorCode: string | null = null;
      try {
        if (!isAllowedPushEndpoint(delivery.endpoint)) {
          result = "failed";
          errorCode = "invalid_endpoint";
        } else {
          const subscriber = server.subscribe({
            endpoint: delivery.endpoint,
            keys: { p256dh: delivery.p256dh, auth: delivery.auth_key },
          });
          await subscriber.pushTextMessage(
            JSON.stringify({
              userId: delivery.user_id,
              orderId: delivery.order_id,
              businessId: delivery.business_id,
              number: delivery.order_number,
            }),
            {
              ttl: 900,
              urgency: Urgency.High,
              topic: delivery.order_id.replaceAll("-", ""),
            },
          );
          sent++;
        }
      } catch (error) {
        const status = (error as { response?: Response }).response?.status;
        result =
          status === 404 || status === 410
            ? "gone"
            : status === 429 || !status || status >= 500
              ? "retry"
              : "failed";
        errorCode = status ? "push_http_" + status : "push_transport";
      }
      const finished = await db.rpc("morfi_finish_push_delivery", {
        p_event_id: delivery.event_id,
        p_subscription_id: delivery.subscription_id,
        p_lease_id: delivery.lease_id,
        p_result: result,
        p_error: errorCode,
      });
      if (finished.error) console.error("Unable to record push result");
    }
    return Response.json({ processed: claimed.data?.length ?? 0, sent });
  } catch {
    console.error("Order push worker could not complete its batch");
    return new Response("Worker unavailable", { status: 503 });
  }
});
