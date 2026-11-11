import { supabase } from "../lib/supabaseClient";
import { pushOwner } from "./pushStore";
const keyName = "morfi_push_installation";
export function installationId() {
  let id = localStorage.getItem(keyName);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(keyName, id);
  }
  return id;
}
export function supportsPush() {
  return (
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}
export async function enableOrderPush(userId: string) {
  if (!supabase || !supportsPush())
    throw new Error("Este navegador no admite avisos de pedidos.");
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapid)
    throw new Error("Los avisos todavía no están habilitados en esta versión.");
  // Ask synchronously from the click handler, before awaiting registration/network.
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "El navegador no permitió los avisos. Podés habilitarlos desde la configuración del sitio.",
    );
  const registration = await navigator.serviceWorker.ready;
  const raw = atob(vapid.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }));
  const serialized = subscription.toJSON();
  const r = await supabase.rpc("morfi_register_push", {
    p_installation_id: installationId(),
    p_endpoint: serialized.endpoint,
    p_p256dh: serialized.keys?.p256dh,
    p_auth: serialized.keys?.auth,
  });
  if (r.error) {
    await subscription.unsubscribe();
    throw r.error;
  }
  await pushOwner(userId);
}
export async function disableOrderPush() {
  // Clear the worker owner first; a shared device must not display another account's order.
  await pushOwner(null);
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      if (await registration!.pushManager.getSubscription())
        throw new Error(
          "No se pudieron desactivar los avisos de este dispositivo. Intentá otra vez antes de salir.",
        );
    }
    const notices = await registration?.getNotifications();
    notices?.forEach((n) => n.close());
  }
  if (supabase) {
    const r = await supabase.rpc("morfi_revoke_push", {
      p_installation_id: installationId(),
    });
    if (r.error && r.error.code !== "PGRST202")
      console.warn(
        "La suscripción local está desactivada; queda pendiente revocar el registro del servidor.",
      );
  }
}
export async function orderPushEnabled() {
  if (!supabase || !supportsPush() || Notification.permission !== "granted")
    return false;
  const owner = await pushOwner();
  if (!owner || !(await navigator.serviceWorker.getRegistration())?.pushManager)
    return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!(await registration!.pushManager.getSubscription())) return false;
  const r = await supabase
    .from("morfi_push_subscriptions")
    .select("enabled")
    .eq("installation_id", installationId())
    .maybeSingle();
  return !r.error && r.data?.enabled === true;
}
