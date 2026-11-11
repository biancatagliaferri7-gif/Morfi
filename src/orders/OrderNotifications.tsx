import { useEffect, useRef, useState } from "react";
import {
  disableOrderPush,
  enableOrderPush,
  orderPushEnabled,
  supportsPush,
} from "./pushService";
import { claimOrderNotice } from "./pushStore";
import { primaryClass, setupError } from "../business/sellerSetup";
import type { MealOrder } from "./orderService";
let audio: AudioContext | null = null;
function beep() {
  if (!audio || audio.state !== "running") return;
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  tone.connect(gain);
  gain.connect(audio.destination);
  tone.frequency.value = 740;
  gain.gain.setValueAtTime(0.12, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
  tone.start();
  tone.stop(audio.currentTime + 0.4);
}
export function OrderNotificationSettings({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sound, setSound] = useState(
    localStorage.getItem("morfi_sound_" + userId) === "true",
  );
  useEffect(() => {
    let active = true;
    void orderPushEnabled().then((v) => {
      if (active) setEnabled(v);
    });
    return () => {
      active = false;
    };
  }, [userId]);
  async function change() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (enabled) await disableOrderPush();
      else await enableOrderPush(userId);
      setEnabled(!enabled);
      setMessage(
        enabled
          ? "Avisos desactivados en este dispositivo."
          : "Avisos activados en este dispositivo.",
      );
    } catch (e) {
      setMessage(setupError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-4 space-y-3">
      <p>
        Recibí un aviso cuando llegue un nuevo pedido, incluso con MORFI en
        segundo plano.
      </p>
      <p className="text-sm text-gray-600">
        En iPhone o iPad, primero agregá MORFI a la pantalla de inicio y abrila
        desde su ícono. El dispositivo debe permitir notificaciones.
      </p>
      <p role="status" className="font-semibold">
        {!supportsPush()
          ? "Este navegador no admite avisos push."
          : Notification.permission === "denied"
            ? "Avisos bloqueados por el navegador."
            : enabled
              ? "Avisos activados"
              : "Avisos desactivados"}
      </p>
      <button
        type="button"
        className={primaryClass}
        disabled={busy || !supportsPush()}
        onClick={() => void change()}
      >
        {busy
          ? "Guardando…"
          : enabled
            ? "Desactivar avisos"
            : "Activar avisos de pedidos"}
      </button>
      <label className="flex min-h-12 items-center gap-3">
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => {
            setSound(e.target.checked);
            localStorage.setItem(
              "morfi_sound_" + userId,
              String(e.target.checked),
            );
            if (e.target.checked) {
              audio ??= new AudioContext();
              void audio.resume().then(beep);
            }
          }}
        />
        Sonido cuando MORFI está abierta
      </label>
      {sound && (
        <button
          type="button"
          className="min-h-11 underline"
          onClick={() => {
            audio ??= new AudioContext();
            void audio.resume().then(beep);
          }}
        >
          Probar sonido
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function useOrderAlerts(
  orders: MealOrder[],
  userId: string,
  businessId: string,
  loaded: boolean,
) {
  useEffect(() => {
    const unlock = () => {
      if (localStorage.getItem("morfi_sound_" + userId) === "true") {
        audio ??= new AudioContext();
        void audio.resume();
      }
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [userId]);
  const baseline = useRef<{ business: string; ids: Set<string> } | null>(null);
  const [notice, setNotice] = useState<{
    orderId: string;
    number: string;
    businessId: string;
  } | null>(null);
  async function announce(id: string, number: string, business: string) {
    if (await claimOrderNotice(`toast:${userId}:${id}`)) {
      setNotice({ orderId: id, number, businessId: business });
      if (localStorage.getItem("morfi_sound_" + userId) === "true") beep();
    }
  }
  useEffect(() => {
    if (!loaded) return;
    if (!baseline.current || baseline.current.business !== businessId) {
      baseline.current = {
        business: businessId,
        ids: new Set(orders.map((o) => o.id)),
      };
      return;
    }
    for (const order of orders) {
      if (!baseline.current.ids.has(order.id) && order.status === "pending")
        void announce(
          order.id,
          String(order.order_number ?? ""),
          businessId,
        ).catch(() => {});
    }
    baseline.current.ids = new Set(orders.map((o) => o.id));
  }, [orders, userId, businessId, loaded]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const p = event.data;
      if (p?.type === "MORFI_NEW_ORDER" && p.userId === userId)
        void announce(p.orderId, String(p.number ?? ""), p.businessId).catch(
          () => {},
        );
    };
    navigator.serviceWorker?.addEventListener("message", receive);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", receive);
  }, [userId]);
  return { notice, dismiss: () => setNotice(null) };
}
