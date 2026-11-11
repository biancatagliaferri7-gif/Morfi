import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const privateJwk = privateKey.export({ format: "jwk" });
privateJwk.key_ops = ["sign"];
privateJwk.ext = true;
const publicJwk = publicKey.export({ format: "jwk" });
const publicRaw = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(publicJwk.x, "base64url"),
  Buffer.from(publicJwk.y, "base64url"),
]).toString("base64url");
const dir = ".morfi-secrets.local";
await mkdir(dir, { recursive: true });
// Separate keys per environment; no private values are printed.
const prefix = dir + "/push-" + Date.now();
const values = {
  VITE_VAPID_PUBLIC_KEY: publicRaw,
  VAPID_PRIVATE_JWK: JSON.stringify(privateJwk),
  VAPID_SUBJECT: "https://morfi-ten.vercel.app/",
  MORFI_PUSH_WORKER_SECRET: randomBytes(32).toString("base64url"),
};
await writeFile(prefix + ".json", JSON.stringify(values, null, 2), {
  mode: 0o600,
  flag: "wx",
});
await writeFile(
  prefix + ".env",
  Object.entries(values)
    .filter(([k]) => !k.startsWith("VITE_"))
    .map(([k, v]) => k + "=" + v)
    .join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Claves: " +
    prefix +
    ".json; secretos de servidor: " +
    prefix +
    ".env. Copiar solo VITE_VAPID_PUBLIC_KEY a Vercel.",
);
