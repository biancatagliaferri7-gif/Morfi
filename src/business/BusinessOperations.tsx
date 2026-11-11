import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  getAvailability,
  openingLabel,
  primaryClass,
  setupError,
} from "./sellerSetup";
import type { Availability, OpeningHours } from "./sellerSetup";
import { HoursFields } from "./SellerFields";
export default function BusinessOperations({
  businessId,
  productCount = 0,
  onPublished,
}: {
  businessId: string;
  productCount?: number;
  onPublished?: () => void;
}) {
  const [state, setState] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      setState(await getAvailability(businessId));
      setError("");
    } catch (e) {
      setError(setupError(e));
    }
  }
  useEffect(() => {
    let active = true;
    const load = () => {
      void getAvailability(businessId)
        .then((s) => {
          if (active) setState(s);
        })
        .catch((e) => {
          if (active) setError(setupError(e));
        });
    };
    setState(null);
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener("morfi-business-changed", load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("morfi-business-changed", load);
    };
  }, [businessId]);
  async function publish() {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const r = await supabase
        .from("morfi_businesses")
        .update({ is_published: true })
        .eq("id", businessId)
        .select("id")
        .single();
      if (r.error) throw r.error;
      onPublished?.();
      window.dispatchEvent(new Event("morfi-business-changed"));
      await refresh();
    } catch (e) {
      setError(setupError(e));
    } finally {
      setBusy(false);
    }
  }
  async function action() {
    if (!supabase || !state || busy) return;
    setBusy(true);
    try {
      const r = await supabase.rpc("morfi_set_order_reception", {
        p_business_id: businessId,
        p_action: state.is_open
          ? "pause"
          : state.state === "paused"
            ? "resume"
            : "open",
      });
      if (r.error) throw r.error;
      await refresh();
    } catch (e) {
      setError(setupError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="mb-5 rounded-2xl border border-orange-200 bg-white p-5"
      aria-label="Recepción de pedidos"
    >
      {error && (
        <p role="alert" className="text-red-800">
          {error}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => void refresh()}
          >
            Reintentar
          </button>
        </p>
      )}
      {!state && !error && (
        <p role="status">Consultando recepción de pedidos…</p>
      )}
      {state && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p role="status" className="text-xl font-black">
              {state.state === "unpublished"
                ? "Comercio sin publicar"
                : state.state === "paused"
                  ? "Pedidos pausados"
                  : state.state === "exceptional"
                    ? "Abierto fuera de horario"
                    : state.is_open
                      ? "Recibiendo pedidos"
                      : "Cerrado"}
            </p>
            {!state.is_open && state.next_open_at && (
              <p className="mt-1 text-sm">
                {state.state === "paused" ? "Se reactiva" : "Próxima apertura"}:{" "}
                {openingLabel(state.next_open_at)}
              </p>
            )}
            {state.state === "exceptional" && (
              <p className="mt-1 text-sm">
                La apertura excepcional termina{" "}
                {openingLabel(state.override_until)}.
              </p>
            )}
          </div>
          {state.state !== "unpublished" && (
            <button
              type="button"
              className={primaryClass}
              disabled={busy}
              onClick={() => void action()}
            >
              {busy
                ? "Guardando…"
                : state.is_open
                  ? "Dejar de tomar pedidos"
                  : state.state === "paused"
                    ? "Volver a tomar pedidos"
                    : "Abrir ahora"}
            </button>
          )}
          {state.state === "unpublished" && (
            <p className="text-sm">
              {productCount ? (
                <>
                  Tu primer producto está listo.{" "}
                  <button
                    type="button"
                    className={primaryClass + " ml-2"}
                    disabled={busy}
                    onClick={() => void publish()}
                  >
                    Publicar mi comercio
                  </button>
                </>
              ) : (
                <>Cargá tu primer producto para publicar tu comercio.</>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
export function BusinessHours({ businessId }: { businessId: string }) {
  const [hours, setHours] = useState<OpeningHours[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void supabase
      ?.from("morfi_business_hours")
      .select("weekday,slot,opens,closes")
      .eq("business_id", businessId)
      .then((r) => {
        if (!active) return;
        if (r.error) setError(setupError(r.error));
        else
          setHours(
            r.data.map((h) => ({
              ...h,
              opens: h.opens.slice(0, 5),
              closes: h.closes.slice(0, 5),
            })),
          );
      });
    return () => {
      active = false;
    };
  }, [businessId]);
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !supabase) return;
        setBusy(true);
        setError("");
        setNotice("");
        void Promise.resolve(
          supabase.rpc("morfi_save_business_hours", {
            p_business_id: businessId,
            p_hours: hours,
          }),
        )
          .then((r) => {
            if (r.error) throw r.error;
            window.dispatchEvent(new Event("morfi-business-changed"));
            setNotice(
              "Horarios guardados. Las pausas y aperturas excepcionales se ajustaron al nuevo horario.",
            );
          })
          .catch((e) => setError(setupError(e)))
          .finally(() => setBusy(false));
      }}
    >
      <HoursFields hours={hours} onChange={setHours} />
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button className={primaryClass} disabled={busy}>
        {busy ? "Guardando…" : "Guardar horarios"}
      </button>
    </form>
  );
}
