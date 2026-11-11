import { useEffect, useRef, useState, useId } from "react";
import type * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { argentinePaymentProviders } from "./paymentOptions";
import { fieldClass } from "./sellerSetup";
import type { SellerSetupData, OpeningHours } from "./sellerSetup";
export function BankFields({
  data,
  onChange,
}: {
  data: Pick<
    SellerSetupData,
    "bank_name" | "bank_cuit" | "transfer_alias" | "transfer_holder"
  >;
  onChange: (patch: Partial<SellerSetupData>) => void;
}) {
  const bankId = useId();
  const known = (argentinePaymentProviders as readonly string[]).includes(
    data.bank_name,
  );
  const [other, setOther] = useState(Boolean(data.bank_name && !known));
  return (
    <div className="space-y-3">
      <label htmlFor={bankId} className="block font-semibold">
        Banco o billetera
        <select
          id={bankId}
          className={fieldClass}
          value={other ? "Otro" : data.bank_name}
          onChange={(e) => {
            setOther(e.target.value === "Otro");
            onChange({
              bank_name: e.target.value === "Otro" ? "" : e.target.value,
            });
          }}
          required
        >
          <option value="">Elegí una opción</option>
          {argentinePaymentProviders.map((p) => (
            <option key={p}>{p}</option>
          ))}
          <option>Otro</option>
        </select>
      </label>
      {other && (
        <label className="block font-semibold">
          Nombre del banco o billetera
          <input
            className={fieldClass}
            value={data.bank_name}
            onChange={(e) => onChange({ bank_name: e.target.value })}
            maxLength={120}
            required
          />
        </label>
      )}
      {(
        [
          ["transfer_alias", "Alias"],
          ["transfer_holder", "Titular de la cuenta"],
          ["bank_cuit", "CUIT/CUIL del titular"],
        ] as const
      ).map(([key, label]) => (
        <label className="block font-semibold" key={key}>
          {label}
          <input
            className={fieldClass}
            value={data[key]}
            onChange={(e) =>
              onChange({
                [key]:
                  key === "bank_cuit"
                    ? e.target.value.replace(/\D/g, "")
                    : e.target.value,
              })
            }
            inputMode={key === "bank_cuit" ? "numeric" : "text"}
            maxLength={key === "bank_cuit" ? 11 : 120}
            required
          />
        </label>
      ))}
    </div>
  );
}
const days = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
export function HoursFields({
  hours,
  onChange,
}: {
  hours: OpeningHours[];
  onChange: (h: OpeningHours[]) => void;
}) {
  const edit = (
    day: number,
    slot: number,
    key: "opens" | "closes",
    value: string,
  ) =>
    onChange(
      hours.map((h) =>
        h.weekday === day && h.slot === slot ? { ...h, [key]: value } : h,
      ),
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Horarios de La Rioja. Si el cierre es anterior a la apertura, termina al
        día siguiente.
      </p>
      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
        const rows = hours
          .filter((h) => h.weekday === day)
          .sort((a, b) => a.slot - b.slot);
        return (
          <fieldset
            key={day}
            className="rounded-xl border border-orange-100 p-3"
          >
            <legend className="px-1 font-bold">{days[day]}</legend>
            <label className="inline-flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={!!rows.length}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [
                          ...hours,
                          {
                            weekday: day,
                            slot: 0,
                            opens: "12:00",
                            closes: "15:00",
                          },
                        ]
                      : hours.filter((h) => h.weekday !== day),
                  )
                }
              />
              Atiendo este día
            </label>
            {rows.map((h) => (
              <div
                key={h.slot}
                className="mt-2 grid grid-cols-1 min-[420px]:grid-cols-2 gap-3"
              >
                <label>
                  Abro
                  <input
                    aria-label={`${days[day]} apertura ${h.slot + 1}`}
                    className={fieldClass}
                    type="time"
                    value={h.opens}
                    onChange={(e) => edit(day, h.slot, "opens", e.target.value)}
                    required
                  />
                </label>
                <label>
                  Cierro
                  <input
                    aria-label={`${days[day]} cierre ${h.slot + 1}`}
                    className={fieldClass}
                    type="time"
                    value={h.closes}
                    onChange={(e) =>
                      edit(day, h.slot, "closes", e.target.value)
                    }
                    required
                  />
                </label>
                {h.slot === 1 && (
                  <button
                    type="button"
                    className="min-[420px]:col-span-2 min-h-11 text-left text-sm font-semibold underline"
                    onClick={() => onChange(hours.filter((r) => r !== h))}
                  >
                    Quitar segundo horario
                  </button>
                )}
              </div>
            ))}
            {rows.length === 1 && (
              <button
                type="button"
                className="mt-2 min-h-11 text-sm font-semibold underline"
                onClick={() =>
                  onChange([
                    ...hours,
                    { weekday: day, slot: 1, opens: "20:00", closes: "23:00" },
                  ])
                }
              >
                Agregar otro horario
              </button>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
export function LocationFields({
  data,
  onChange,
}: {
  data: Pick<SellerSetupData, "location" | "latitude" | "longitude">;
  onChange: (p: Partial<SellerSetupData>) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const [mapReady, setMapReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [showMap, setShowMap] = useState(data.latitude !== null);
  useEffect(() => {
    if (!showMap || !container.current) return;
    let cancelled = false;
    let instance: maplibregl.Map | null = null;
    void import("maplibre-gl")
      .then((lib) => {
        if (cancelled || !container.current) return;
        lib.setWorkerUrl(mapWorkerUrl);
        const m = new lib.Map({
          container: container.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          },
          center: [data.longitude ?? -66.855, data.latitude ?? -29.413],
          zoom: 14,
        });
        instance = m;
        map.current = m;
        m.addControl(new lib.NavigationControl());
        m.on("click", (e) =>
          changeRef.current({
            latitude: e.lngLat.lat,
            longitude: e.lngLat.lng,
          }),
        );
        m.on("error", () =>
          setNotice(
            "El mapa no pudo cargar. Revisá tu conexión o usá las coordenadas debajo.",
          ),
        );
        setMapReady(true);
      })
      .catch(() =>
        setNotice(
          "No se pudo cargar el mapa. Podés ingresar las coordenadas debajo.",
        ),
      );
    return () => {
      cancelled = true;
      marker.current?.remove();
      marker.current = null;
      instance?.remove();
      map.current = null;
    };
  }, [showMap]);
  useEffect(() => {
    if (!map.current || data.latitude === null || data.longitude === null)
      return;
    let cancelled = false;
    void import("maplibre-gl").then((lib) => {
      if (cancelled || !map.current) return;
      marker.current?.remove();
      marker.current = new lib.Marker({ draggable: true })
        .setLngLat([data.longitude!, data.latitude!])
        .addTo(map.current);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLngLat();
        changeRef.current({ latitude: p.lat, longitude: p.lng });
      });
      map.current.flyTo({ center: [data.longitude!, data.latitude!] });
    });
    return () => {
      cancelled = true;
    };
  }, [data.latitude, data.longitude, showMap, mapReady]);
  function gps() {
    if (!navigator.geolocation) {
      setNotice("Este dispositivo no tiene GPS. Marcá el lugar en el mapa.");
      setShowMap(true);
      return;
    }
    setNotice("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
        });
        setShowMap(true);
        setNotice("Ubicación lista. Podés mover el punto hasta tu local.");
      },
      () => {
        setNotice("No se pudo obtener el GPS. Marcá el punto en el mapa.");
        setShowMap(true);
      },
      { timeout: 12000, enableHighAccuracy: true },
    );
  }
  return (
    <div className="space-y-3">
      <label className="block font-semibold">
        Dirección del punto de venta
        <input
          className={fieldClass}
          value={data.location}
          onChange={(e) => onChange({ location: e.target.value })}
          maxLength={180}
          placeholder="Calle, número, barrio y localidad"
          required
        />
      </label>
      <p className="text-sm text-gray-600">
        La dirección y el punto de venta se mostrarán a tus clientes. El mapa
        usa OpenStreetMap.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="min-h-12 rounded-xl border px-4 font-semibold"
          type="button"
          onClick={gps}
        >
          Usar mi ubicación
        </button>
        <button
          type="button"
          className="min-h-12 rounded-xl border px-4 font-semibold"
          onClick={() => setShowMap(true)}
        >
          Marcar en el mapa
        </button>
      </div>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {showMap && (
        <>
          <div
            ref={container}
            className="h-64 w-full rounded-xl border"
            role="region"
            aria-label="Marcá el punto de venta en el mapa"
          />
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">
              Ingresar coordenadas con teclado
            </summary>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              {(["latitude", "longitude"] as const).map((k) => (
                <label key={k}>
                  {k === "latitude" ? "Latitud" : "Longitud"}
                  <input
                    className={fieldClass}
                    type="number"
                    step="any"
                    min={k === "latitude" ? -90 : -180}
                    max={k === "latitude" ? 90 : 180}
                    value={data[k] ?? ""}
                    onChange={(e) =>
                      onChange({
                        [k]:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
        </>
      )}
      {data.latitude !== null && data.longitude !== null && (
        <p className="text-sm font-semibold text-green-800">
          Punto de venta seleccionado.
        </p>
      )}
    </div>
  );
}
