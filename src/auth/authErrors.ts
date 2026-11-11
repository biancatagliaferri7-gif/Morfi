import { passwordErrorMessage } from "./passwordErrors";
export function authErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  if (/invalid login credentials|invalid credentials/i.test(message))
    return "El correo o la contraseña no son correctos.";
  if (
    /invalid email|email address.*invalid|unable to validate email/i.test(
      message,
    )
  )
    return "El correo electrónico no tiene un formato válido. Revisá que esté escrito correctamente.";
  if (/email not confirmed/i.test(message))
    return "Confirmá tu correo desde el enlace que te enviamos antes de ingresar.";
  if (
    /already registered|already exists|user already registered/i.test(
      message,
    ) ||
    code === "user_already_exists"
  )
    return "Ese correo ya tiene una cuenta. Elegí “Ingresar” para continuar.";
  if (code === "email_address_not_authorized")
    return "MORFI todavía no puede enviar correos a esta dirección. Avisá al equipo para que configure el envío de correos.";
  if (code === "over_email_send_rate_limit")
    return "MORFI alcanzó el límite de correos por ahora. Intentá reenviar la confirmación más tarde.";
  if (/morfi_profiles_dni_unique|duplicate key.*dni/i.test(message))
    return "Ya existe una cuenta emprendedora registrada con ese DNI.";
  const passwordAdvice = passwordErrorMessage(error);
  if (passwordAdvice) return passwordAdvice;
  if (/rate limit|too many requests/i.test(message))
    return "Se realizaron demasiados intentos. Esperá unos minutos e intentá de nuevo.";
  if (/email.*(smtp|provider|send)/i.test(message))
    return "No se pudo enviar el correo. Revisá que el proveedor Email y el envío de correos estén configurados en Supabase.";
  if (
    /database error saving new user/i.test(message) ||
    code === "database_error"
  ) {
    return "No pudimos crear la cuenta. Si ya registraste tu DNI en MORFI, ingresá con esa cuenta o pedí ayuda para recuperarla. Si no, avisá al equipo del proyecto antes de volver a intentarlo.";
  }
  if (/invalid api key|no api key|invalid jwt/i.test(message)) {
    return "Supabase rechazó las credenciales de conexión de esta versión. Revisá VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en las variables de Preview de Vercel y redeployá.";
  }
  if (
    /registro sin usuario|no se recibió una respuesta de cuenta/i.test(message)
  ) {
    return "Supabase no confirmó la creación de la cuenta. Revisá la configuración de Preview y los Auth Logs antes de volver a intentarlo.";
  }
  if (/fetch|network/i.test(message))
    return "No se pudo conectar con Supabase. Revisá la URL y tu conexión a internet.";
  return message
    ? `No se pudo completar la operación: ${message}`
    : "No se pudo completar la operación. Revisá los datos e intentá nuevamente.";
}
