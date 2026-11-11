import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { supabase } from "../lib/supabaseClient";
import { uploadBusinessLogo } from "../business/businessService";
import {
  BankFields,
  HoursFields,
  LocationFields,
} from "../business/SellerFields";
import {
  completeDraft,
  emptySetup,
  fieldClass,
  loadDraft,
  normalizePhone,
  primaryClass,
  saveDraft,
  saveIdentity,
  setupError,
  validateSetupStep,
} from "../business/sellerSetup";
import type { SellerDraft, SellerSetupData } from "../business/sellerSetup";
export default function SellerRegister({
  branch = false,
}: {
  branch?: boolean;
}) {
  const { session, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const parent = branch ? params.get("parent") : null;
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<SellerDraft | null>(null);
  const [data, setData] = useState<SellerSetupData>({ ...emptySetup });
  const [name, setName] = useState("");
  const [dni, setDni] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [completed, setCompleted] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [step]);
  const initialized = useRef(false);
  const submitLock = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patch = (p: Partial<SellerSetupData>) =>
    setData((d) => ({ ...d, ...p }));
  useEffect(() => {
    if (!logo) {
      setLogoPreview("");
      return;
    }
    const u = URL.createObjectURL(logo);
    setLogoPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [logo]);
  useEffect(() => {
    if (submitLock.current) return;
    initialized.current = false;
    if (!session || !supabase) return;
    let active = true;
    setInitializing(true);
    void (async () => {
      if (branch && !parent)
        throw new Error("Elegí el comercio al que pertenece la sucursal.");
      const p = await supabase!
        .from("morfi_profiles")
        .select("full_name,dni,phone")
        .eq("id", session.user.id)
        .single();
      if (p.error) throw p.error;
      const draftId = params.get("draft");
      let d: SellerDraft;
      if (draftId) {
        const r = await supabase!
          .from("morfi_seller_setup_drafts")
          .select("*")
          .eq("id", draftId)
          .single();
        if (r.error) throw r.error;
        d = r.data;
        if (d.parent_business_id !== parent)
          throw new Error("El borrador pertenece a otro registro.");
      } else {
        if (!branch) {
          const m = await supabase!
            .from("morfi_business_memberships")
            .select("business_id")
            .eq("user_id", session.user.id)
            .in("role", ["owner", "manager"])
            .limit(1);
          if (m.error) throw m.error;
          if (m.data.length) {
            navigate("/business", { replace: true });
            return;
          }
        }
        d = await loadDraft(parent);
      }
      if (!active) return;
      if (d.result_business_id) {
        navigate("/business?business=" + d.result_business_id, {
          replace: true,
        });
        return;
      }
      setDraft(d);
      setName(p.data.full_name ?? "");
      setDni(p.data.dni ?? "");
      setPhone(p.data.phone ?? "");
      setEmail(session.user.email ?? "");
      setData({
        ...emptySetup,
        ...d.data,
        phone: d.data.phone || p.data.phone || "",
      });
      setStep(p.data.dni && p.data.full_name && p.data.phone ? d.step : 1);
      initialized.current = true;
      if (!draftId)
        setParams(
          (prev) => {
            prev.set("draft", d.id);
            return prev;
          },
          { replace: true },
        );
    })()
      .catch((e) => {
        if (active) setError(setupError(e));
      })
      .finally(() => {
        if (active) setInitializing(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id, parent, branch]);
  useEffect(() => {
    if (!initialized.current || !draft || step === 1 || completed) return;
    saveTimer.current = setTimeout(() => {
      void saveDraft(draft.id, data, step)
        .then(() => setNotice("Borrador guardado. Podés continuar después."))
        .catch(() =>
          setNotice(
            "No se pudo guardar el último cambio. Conservamos los datos en esta pantalla; reintentá antes de salir.",
          ),
        );
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [data, step, draft?.id, completed]);
  async function identity() {
    if (!supabase) throw new Error("El registro no está disponible.");
    if (
      name.trim().length < 2 ||
      !/^\d{7,10}$/.test(dni) ||
      !normalizePhone(phone)
    )
      throw new Error("Completá nombre y apellido, DNI y un WhatsApp válido.");
    let accountId = session?.user.id;
    if (!session) {
      const r = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: name.trim(),
            phone: normalizePhone(phone),
            enabled_panels: ["cliente"],
            business_setup_deferred: true,
          },
          emailRedirectTo: location.origin + "/auth/callback",
        },
      });
      setPassword("");
      if (r.error) throw r.error;
      accountId = r.data.user?.id;
      if (!r.data.session) {
        setNotice(
          "Confirmá tu correo si el servicio lo solicita. Después ingresá para continuar tu emprendimiento.",
        );
        return;
      }
    }
    await saveIdentity(name, dni, phone);
    if (!accountId) throw new Error("Ingresá para continuar el registro.");
    await refreshProfile(accountId);
    const ownDraft = draft ?? (await loadDraft(parent));
    setDraft(ownDraft);
    patch({ phone: normalizePhone(phone) });
    initialized.current = true;
    setParams(
      (prev) => {
        prev.set("draft", ownDraft.id);
        return prev;
      },
      { replace: true },
    );
    setStep(2);
  }
  async function next(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      if (step === 1) {
        await identity();
        return;
      }
      if (!draft)
        throw new Error("Volvé a ingresar para recuperar tu borrador.");
      if (!completed) {
        const validation = validateSetupStep(data, step);
        if (validation) throw new Error(validation);
        const clean = {
          ...data,
          bank_cuit: data.bank_cuit.replace(/\D/g, ""),
          phone: normalizePhone(data.phone),
        };
        await saveDraft(draft.id, clean, Math.min(4, step + 1));
        if (step < 4) {
          setStep(step + 1);
          return;
        }
      }
      const id = completed ?? (await completeDraft(draft.id));
      setCompleted(id);
      await refreshProfile();
      if (logo) {
        try {
          await uploadBusinessLogo(id, logo);
        } catch {
          setError(
            "Tu emprendimiento ya está creado. No pudimos subir el logo. Reintentá o continuá sin logo.",
          );
          return;
        }
      }
      navigate("/business?business=" + id, { replace: true });
    } catch (e) {
      setError(setupError(e));
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }
  const titles = [
    "Tus datos",
    "Tu emprendimiento",
    "Tus horarios",
    "Cómo cobrás y entregás",
  ];
  if (loading || initializing)
    return (
      <main className="p-8" role="status">
        Preparando tu registro…
      </main>
    );
  if (branch && !session)
    return (
      <main className="p-8">
        <Link
          to={
            "/login?next=" +
            encodeURIComponent("/business/branches/new?parent=" + parent)
          }
        >
          Ingresá para agregar una sucursal
        </Link>
      </main>
    );
  return (
    <main className="min-h-screen bg-[#FFF3E5] px-4 py-8 text-[#8B3F14]">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-5 shadow-sm sm:p-8">
        <Link to={branch ? "/business" : "/register"}>
          ← {branch ? "Volver al panel" : "Volver al registro de clientes"}
        </Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-wide">
          {branch ? "Agregar sucursal" : "Registro emprendedor"} · Paso {step}{" "}
          de 4
        </p>
        <div className="mt-3 flex gap-2" aria-hidden="true">
          {titles.map((_, i) => (
            <span
              key={i}
              className={
                "h-2 flex-1 rounded-full " +
                (i < step ? "bg-[#B94E12]" : "bg-orange-100")
              }
            />
          ))}
        </div>
        <h1 ref={heading} className="mt-5 text-3xl font-black" tabIndex={-1}>
          {titles[step - 1]}
        </h1>
        <form onSubmit={(e) => void next(e)} className="mt-6 space-y-5">
          {step === 1 && (
            <>
              <p className="text-gray-600">
                Estos datos identifican a la persona que administra el comercio.
              </p>
              <label className="block font-semibold">
                Nombre y apellido
                <input
                  className={fieldClass}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label className="block font-semibold">
                DNI N°
                <input
                  className={fieldClass}
                  inputMode="numeric"
                  value={dni}
                  onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))}
                  minLength={7}
                  maxLength={10}
                  required
                />
              </label>
              <label className="block font-semibold">
                WhatsApp público donde recibirás pedidos
                <input
                  type="tel"
                  className={fieldClass}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="3804123456"
                  required
                  maxLength={16}
                />
              </label>
              <p className="text-sm text-gray-600">
                Se mostrará a tus clientes. Podés ingresar los 10 números
                argentinos; agregamos el prefijo automáticamente.
              </p>
              {!session && (
                <>
                  <label className="block font-semibold">
                    Correo electrónico
                    <input
                      className={fieldClass}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      maxLength={254}
                    />
                  </label>
                  <label className="block font-semibold">
                    Contraseña
                    <input
                      className={fieldClass}
                      autoComplete="new-password"
                      type={visible ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      maxLength={72}
                      required
                    />
                  </label>
                  <button
                    type="button"
                    className="min-h-11 underline"
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? "Ocultar" : "Mostrar"} contraseña
                  </button>
                  <p className="text-sm">
                    Usá mayúsculas, minúsculas, números y un símbolo.
                  </p>
                  <Link
                    to="/login?next=%2Fregister%2Femprendedor"
                    className="block min-h-11 py-2 font-semibold underline"
                  >
                    Ya tengo cuenta: ingresar y continuar
                  </Link>
                </>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <label className="block font-semibold">
                {branch
                  ? "Nombre de esta sucursal"
                  : "Nombre del emprendimiento"}
                <input
                  className={fieldClass}
                  value={data.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  maxLength={120}
                  required
                />
              </label>
              {branch && (
                <label className="block font-semibold">
                  WhatsApp público de esta sucursal
                  <input
                    className={fieldClass}
                    type="tel"
                    value={data.phone}
                    onChange={(e) => patch({ phone: e.target.value })}
                    required
                  />
                </label>
              )}
              <label className="block font-semibold">
                Logo del emprendimiento (opcional)
                <input
                  className="mt-2 block max-w-full text-base"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (
                      f &&
                      (!["image/jpeg", "image/png", "image/webp"].includes(
                        f.type,
                      ) ||
                        f.size > 5242880)
                    ) {
                      setError("Elegí JPG, PNG o WebP de hasta 5 MB.");
                      return;
                    }
                    setLogo(f ?? null);
                  }}
                />
              </label>
              {logoPreview && (
                <img
                  src={logoPreview}
                  alt="Vista previa del logo"
                  className="h-24 w-24 rounded-xl object-contain"
                />
              )}
              <p className="text-sm text-gray-600">
                Si cerrás esta pantalla, podés volver a elegir el logo después.
              </p>
              <LocationFields data={data} onChange={patch} />
            </>
          )}
          {step === 3 && (
            <HoursFields
              hours={data.hours}
              onChange={(hours) => patch({ hours })}
            />
          )}
          {step === 4 && (
            <>
              <label className="block font-semibold">
                ¿Aceptás pago con transferencia?
                <select
                  className={fieldClass}
                  value={String(data.accepts_transfer)}
                  onChange={(e) =>
                    patch({ accepts_transfer: e.target.value === "true" })
                  }
                >
                  <option value="false">No</option>
                  <option value="true">Sí</option>
                </select>
              </label>
              <p className="text-sm text-gray-600">
                Tus clientes siempre pueden pagar en efectivo.
              </p>
              {data.accepts_transfer && (
                <BankFields data={data} onChange={patch} />
              )}
              <label className="block font-semibold">
                ¿Realizás envíos a domicilio?
                <select
                  className={fieldClass}
                  value={String(data.accepts_delivery)}
                  onChange={(e) =>
                    patch({ accepts_delivery: e.target.value === "true" })
                  }
                >
                  <option value="false">No</option>
                  <option value="true">Sí</option>
                </select>
              </label>
              {data.accepts_delivery && (
                <p className="text-sm text-gray-600">
                  El costo se coordina con cada pedido. Podés configurar una
                  tarifa después.
                </p>
              )}
              <div className="rounded-xl bg-orange-50 p-4">
                <p className="font-bold">{data.name}</p>
                <p>{data.location}</p>
                <p>WhatsApp: {data.phone}</p>
                <p>
                  {data.hours.length} horario(s) de atención ·{" "}
                  {data.accepts_transfer
                    ? "Efectivo y transferencia"
                    : "Efectivo"}
                </p>
              </div>
            </>
          )}
          {error && (
            <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
              {error}
              {/DNI|correo ya/.test(error) && (
                <Link
                  className="mt-2 block underline"
                  to="/login?next=%2Fregister%2Femprendedor"
                >
                  Ingresar o recuperar mi cuenta
                </Link>
              )}
            </div>
          )}
          {notice && (
            <p role="status" className="text-sm text-gray-600">
              {notice}
            </p>
          )}
          <div className="flex gap-3">
            {step > 1 && !completed && (
              <button
                type="button"
                className="min-h-12 rounded-xl border px-4 font-bold"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setStep(step - 1);
                }}
              >
                Atrás
              </button>
            )}
            <button
              className={primaryClass + " flex-1"}
              disabled={
                busy || !supabase || Boolean(session && step > 1 && !draft)
              }
            >
              {busy
                ? "Guardando…"
                : step === 4
                  ? completed
                    ? "Reintentar logo"
                    : "Terminar registro"
                  : "Continuar"}
            </button>
          </div>
          {completed && (
            <button
              type="button"
              className="min-h-12 w-full underline"
              onClick={() =>
                navigate("/business?business=" + completed, { replace: true })
              }
            >
              Continuar sin logo
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
