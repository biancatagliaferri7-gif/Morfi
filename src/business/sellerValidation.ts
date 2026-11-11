import type { SellerSetupData } from "./sellerSetup";
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10
    ? "+549" + digits
    : /^\+[1-9][0-9]{7,14}$/.test(value)
      ? value
      : "";
}
export function validateSetupStep(data: SellerSetupData, step: number) {
  if (
    step === 2 &&
    (!data.name.trim() ||
      !data.location.trim() ||
      data.latitude === null ||
      data.longitude === null ||
      !Number.isFinite(data.latitude) ||
      !Number.isFinite(data.longitude) ||
      Math.abs(data.latitude) > 90 ||
      Math.abs(data.longitude) > 180)
  )
    return "Completá el nombre, la dirección y el punto en el mapa.";
  if (step === 3 && !data.hours.length)
    return "Elegí al menos un día y horario de atención.";
  if (step === 4 && !normalizePhone(data.phone))
    return "Ingresá un WhatsApp válido para recibir pedidos.";
  if (
    step === 4 &&
    data.accepts_transfer &&
    (!data.bank_name.trim() ||
      !data.transfer_alias.trim() ||
      !data.transfer_holder.trim() ||
      !/^\d{11}$/.test(data.bank_cuit.replace(/\D/g, "")))
  )
    return "Completá banco o billetera, alias, titular y CUIT/CUIL de 11 números.";
  return "";
}
