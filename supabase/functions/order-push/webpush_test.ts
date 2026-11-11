import { ApplicationServer, Urgency } from "jsr:@negrel/webpush@0.5.0";
Deno.test(
  "Deno worker can encrypt a Web Push request without contacting a real device",
  async () => {
    const generatedVapidKeys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", generatedVapidKeys.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", generatedVapidKeys.publicKey);
    const vapidKeys = {
      privateKey: await crypto.subtle.importKey(
        "jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
      ),
      publicKey: await crypto.subtle.importKey(
        "jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"],
      ),
    };
    const receiver = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const encode = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    const p256dh = encode(
      new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey)),
    );
    const auth = encode(crypto.getRandomValues(new Uint8Array(16)));
    const original = globalThis.fetch;
    let sent = false;
    globalThis.fetch = async (_url, options) => {
      if (!options?.headers || !options.body)
        throw new Error("No encrypted push payload");
      sent = true;
      return new Response(null, { status: 201 });
    };
    try {
      const server = await ApplicationServer.new({
        vapidKeys,
        contactInformation: "https://example.invalid/",
      });
      await server
        .subscribe({
          endpoint: "https://fcm.googleapis.com/fcm/send/fixture",
          keys: { p256dh, auth },
        })
        .pushTextMessage(JSON.stringify({ orderId: "fixture" }), {
          ttl: 900,
          urgency: Urgency.High,
        });
      if (!sent) throw new Error("Push was not attempted");
    } finally {
      globalThis.fetch = original;
    }
  },
);
