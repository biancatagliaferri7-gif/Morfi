import { normalizePhone } from "./sellerValidation";
export { normalizePhone, validateSetupStep } from "./sellerValidation";
import { supabase } from "../lib/supabaseClient";
export type OpeningHours = {
  weekday: number;
  slot: number;
  opens: string;
  closes: string;
};
export type SellerSetupData = {
  name: string;
  description: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  hours: OpeningHours[];
  accepts_transfer: boolean;
  accepts_delivery: boolean;
  bank_name: string;
  bank_cuit: string;
  transfer_alias: string;
  transfer_holder: string;
};
export type SellerDraft = {
  id: string;
  step: number;
  data: Partial<SellerSetupData>;
  result_business_id: string | null;
  parent_business_id: string | null;
};
export type Availability = {
  is_open: boolean;
  state: "open" | "closed" | "paused" | "exceptional" | "unpublished";
  next_open_at: string | null;
  override_until: string | null;
};
export const emptySetup: SellerSetupData = {
  name: "",
  description: "",
  location: "",
  latitude: null,
  longitude: null,
  phone: "",
  hours: [],
  accepts_transfer: false,
  accepts_delivery: false,
  bank_name: "",
  bank_cuit: "",
  transfer_alias: "",
  transfer_holder: "",
};
export const fieldClass =
  "mt-1 min-w-0 w-full rounded-xl border border-[#D8C7BB] bg-white p-3 text-base font-normal text-[#422A1F] focus:outline-2 focus:outline-[#F07821]";
export const primaryClass =
  "min-h-12 rounded-xl bg-[#B94E12] px-5 py-3 font-bold text-white disabled:opacity-50";
export function setupError(error: unknown): string {
  const e = error as { code?: string; message?: string };
  const message = e?.message ?? "";
  if (e?.code === "23505" || /dni_unique|DNI.*exists/i.test(message))
    return "Ese DNI ya está asociado a una cuenta. Ingresá con esa cuenta o recuperá el acceso.";
  if (/already registered|already exists/i.test(message))
    return "Ese correo ya tiene una cuenta. Ingresá para continuar el registro.";
  if (/Choose at least one/i.test(message))
    return "Elegí al menos un día y horario de atención.";
  if (/overlap|duplicate opening/i.test(message))
    return "Hay horarios que se superponen. Revisá también los turnos que terminan al día siguiente.";
  if (/opening|opens|closes|hours/i.test(message))
    return "Revisá los horarios: apertura y cierre deben ser distintos.";
  if (/bank|CUIT/i.test(message))
    return "Completá banco o billetera, alias, titular y CUIT/CUIL de 11 números.";
  if (/Mark the selling point/i.test(message))
    return "Marcá el punto de venta en el mapa.";
  if (/password/i.test(message))
    return "Revisá la contraseña: usá entre 8 y 72 caracteres con mayúsculas, minúsculas, números y un símbolo.";
  if (/Not authorized|owner/i.test(message))
    return "Tu cuenta no tiene permiso para realizar este cambio.";
  if (e?.code === "PGRST202" || e?.code === "PGRST205")
    return "Esta versión todavía necesita configurar el registro en el servidor. Avisá al equipo de MORFI.";
  return error instanceof Error && !/fetch|network/i.test(message)
    ? message
    : "No se pudo guardar. Revisá la conexión y volvé a intentar.";
}
function client() {
  if (!supabase) throw new Error("El servicio de registro no está disponible.");
  return supabase;
}
export async function loadDraft(parent: string | null): Promise<SellerDraft> {
  const r = await client().rpc("morfi_get_seller_draft", {
    p_parent_business_id: parent,
  });
  if (r.error) throw r.error;
  return r.data;
}
export async function saveDraft(
  id: string,
  data: SellerSetupData,
  step: number,
) {
  const r = await client().rpc("morfi_save_seller_draft", {
    p_draft_id: id,
    p_data: data,
    p_step: step,
  });
  if (r.error) throw r.error;
}
export async function completeDraft(id: string): Promise<string> {
  const r = await client().rpc("morfi_complete_seller_setup", {
    p_draft_id: id,
  });
  if (r.error) throw r.error;
  return r.data;
}
export async function saveIdentity(name: string, dni: string, phone: string) {
  const r = await client().rpc("morfi_save_seller_identity", {
    p_name: name.trim(),
    p_dni: dni.replace(/\D/g, ""),
    p_phone: normalizePhone(phone),
  });
  if (r.error) throw r.error;
}
export async function getAvailability(id: string): Promise<Availability> {
  const r = await client().rpc("morfi_managed_availability", {
    p_business_id: id,
  });
  if (r.error) throw r.error;
  return r.data[0];
}
export function openingLabel(at: string | null) {
  return at
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/La_Rioja",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(at))
    : "";
}
