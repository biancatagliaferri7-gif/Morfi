import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../AuthContext';
import { argentinePaymentProviders } from '../business/paymentOptions';
import { removePendingBusinessSetup, savePendingBusinessSetup } from '../business/pendingRegistration';
import BusinessLocationMap from '../components/BusinessLocationMap';
import { passwordErrorMessage } from '../auth/passwordErrors';

type AuthMode = 'login' | 'register' | 'recover';
type ProfileType = 'cliente' | 'emprendimiento';

const inputClass = 'mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 text-base font-normal';
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function argentinaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `+549${digits}` : '';
}

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
  if (/invalid login credentials|invalid credentials/i.test(message)) return 'El correo o la contraseña no son correctos.';
  if (/invalid email|email address.*invalid|unable to validate email/i.test(message)) return 'El correo electrónico no tiene un formato válido. Revisá que esté escrito correctamente.';
  if (/email not confirmed/i.test(message)) return 'Confirmá tu correo desde el enlace que te enviamos antes de ingresar.';
  if (/already registered|already exists|user already registered/i.test(message) || code === 'user_already_exists') return 'Ese correo ya tiene una cuenta. Elegí “Ingresar” para continuar.';
  if (code === 'email_address_not_authorized') return 'MORFI todavía no puede enviar correos a esta dirección. Avisá al equipo para que configure el envío de correos.';
  if (code === 'over_email_send_rate_limit') return 'MORFI alcanzó el límite de correos por ahora. Intentá reenviar la confirmación más tarde.';
  if (/morfi_profiles_dni_unique|duplicate key.*dni/i.test(message)) return 'Ya existe una cuenta emprendedora registrada con ese DNI.';
  const passwordAdvice = passwordErrorMessage(error);
  if (passwordAdvice) return passwordAdvice;
  if (/rate limit|too many requests/i.test(message)) return 'Se realizaron demasiados intentos. Esperá unos minutos e intentá de nuevo.';
  if (/email.*(smtp|provider|send)/i.test(message)) return 'No se pudo enviar el correo. Revisá que el proveedor Email y el envío de correos estén configurados en Supabase.';
  if (/database error saving new user/i.test(message) || code === 'database_error') {
    return 'No pudimos crear la cuenta. Si ya registraste tu DNI en MORFI, ingresá con esa cuenta o pedí ayuda para recuperarla. Si no, avisá al equipo del proyecto antes de volver a intentarlo.';
  }
  if (/invalid api key|no api key|invalid jwt/i.test(message)) {
    return 'Supabase rechazó las credenciales de conexión de esta versión. Revisá VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en las variables de Preview de Vercel y redeployá.';
  }
  if (/registro sin usuario|no se recibió una respuesta de cuenta/i.test(message)) {
    return 'Supabase no confirmó la creación de la cuenta. Revisá la configuración de Preview y los Auth Logs antes de volver a intentarlo.';
  }
  if (/fetch|network/i.test(message)) return 'No se pudo conectar con Supabase. Revisá la URL y tu conexión a internet.';
  return message
    ? `No se pudo completar la operación: ${message}`
    : 'No se pudo completar la operación. Revisá los datos e intentá nuevamente.';
}

function logSignupFailure(error: unknown) {
  if (error instanceof Error) {
    const details = error as Error & { code?: unknown; status?: unknown };
    console.error('Falló el registro en Supabase Auth:', {
      name: error.name,
      message: error.message,
      code: typeof details.code === 'string' ? details.code : undefined,
      status: typeof details.status === 'number' ? details.status : undefined,
    });
    return;
  }

  console.error('Falló el registro en Supabase Auth con un error no estándar.');
}

export default function Auth({ initialMode }: { initialMode: AuthMode }) {
  const [searchParams] = useSearchParams();
  const [profileType, setProfileType] = useState<ProfileType>(() =>
    searchParams.get('profile') === 'emprendimiento' ? 'emprendimiento' : 'cliente',
  );
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [configureBusinessNow, setConfigureBusinessNow] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [dni, setDni] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [businessLocation, setBusinessLocation] = useState('');
  const [businessLatitude, setBusinessLatitude] = useState<number | null>(null);
  const [businessLongitude, setBusinessLongitude] = useState<number | null>(null);
  const [businessLocationNotice, setBusinessLocationNotice] = useState('');
  const [businessLogo, setBusinessLogo] = useState<File | null>(null);
  const [businessLogoPreview, setBusinessLogoPreview] = useState('');
  const [acceptsCash, setAcceptsCash] = useState(true);
  const [acceptsTransfer, setAcceptsTransfer] = useState(false);
  const [bankName, setBankName] = useState('');
  const [otherBankName, setOtherBankName] = useState('');
  const [transferAlias, setTransferAlias] = useState('');
  const [transferHolder, setTransferHolder] = useState('');
  const [bankCuit, setBankCuit] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [canResendVerification, setCanResendVerification] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const { configured, loading, session, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const returnTo = searchParams.get('next') || (profileType === 'emprendimiento' ? '/business' : '/');

  useEffect(() => {
    if (!businessLogo) {
      setBusinessLogoPreview('');
      return;
    }
    const preview = URL.createObjectURL(businessLogo);
    setBusinessLogoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [businessLogo]);

  useEffect(() => {
    if (!supabase) return;
    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('recover');
        setErrorMessage('');
        setNotice('Elegí una contraseña nueva para tu cuenta.');
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (searchParams.get('recovery') === '1' && session) {
      setMode('recover');
      setNotice('Elegí una contraseña nueva para tu cuenta.');
    }
  }, [searchParams, session]);

  useEffect(() => {
    if (!session || loading || mode !== 'login' || searchParams.get('recovery') === '1') return;
    const enabledPanels = profile?.enabled_panels ?? session.user.user_metadata.enabled_panels;
    const isEntrepreneur = Array.isArray(enabledPanels) && enabledPanels.includes('emprendimiento');
    navigate(searchParams.get('next') || (isEntrepreneur ? '/business' : '/'), { replace: true });
  }, [loading, mode, navigate, profile, searchParams, session]);

  function useBusinessLocation() {
    setBusinessLocationNotice('');
    if (!navigator.geolocation) {
      setBusinessLocationNotice('Este navegador no ofrece ubicación GPS. Podés continuar sin guardarla.');
      return;
    }

    setBusinessLocationNotice('Solicitando permiso para acceder a tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      position => {
        setBusinessLatitude(position.coords.latitude);
        setBusinessLongitude(position.coords.longitude);
        setBusinessLocationNotice('Ubicación GPS lista para guardar.');
      },
      error => {
        const detail = error.code === error.PERMISSION_DENIED
          ? 'No se autorizó el acceso a la ubicación.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'El GPS no está disponible en este momento.'
            : 'No se pudo obtener la ubicación a tiempo.';
        setBusinessLocationNotice(`${detail} Podés continuar sin guardarla.`);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setNotice('');
    if (mode !== 'recover' || session === null) {
      if (!email.trim()) {
        setErrorMessage('Ingresá tu correo electrónico.');
        return;
      }
      if (!validEmail.test(email.trim())) {
        setErrorMessage('El correo electrónico no tiene un formato válido. Revisá que tenga usuario, @ y dominio; por ejemplo, nombre@gmail.com.');
        return;
      }
    }
    if (mode === 'login' && !password) {
      setErrorMessage('Ingresá tu contraseña para iniciar sesión.');
      return;
    }
    if (mode === 'recover' && !session && !email.trim()) {
      setErrorMessage('Ingresá el correo electrónico de tu cuenta para recuperar la contraseña.');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setErrorMessage('Ingresá tu nombre completo.');
      return;
    }
    if (mode === 'register' && profileType === 'emprendimiento' && configureBusinessNow && dni.trim() && !/^\d{7,10}$/.test(dni.replace(/\D/g, ''))) {
      setErrorMessage('Ingresá un DNI válido de entre 7 y 10 números.');
      return;
    }
    if (mode === 'register' && password.length < 8) {
      setErrorMessage('La contraseña es demasiado corta: debe tener al menos 8 caracteres.');
      return;
    }
    if (mode === 'register' && password.length > 72) {
      setErrorMessage('La contraseña supera el máximo permitido de 72 caracteres.');
      return;
    }
    if (!supabase) {
      setErrorMessage('La autenticación no está disponible. Configurá la URL y la clave pública de Supabase.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      if (mode === 'register') {
        if (name.trim().length > 120) {
          throw new Error('El nombre supera el largo permitido de 120 caracteres.');
        }
        if (email.trim().length > 254) {
          throw new Error('El correo supera el largo permitido de 254 caracteres.');
        }
        const normalizedPhone = argentinaPhone(phone);
        if (profileType === 'emprendimiento' && configureBusinessNow && !normalizedPhone) {
          throw new Error('Teléfono inválido');
        }
        if (profileType === 'emprendimiento' && configureBusinessNow && (!businessName.trim() || !businessLocation.trim())) {
          throw new Error('Datos del emprendimiento incompletos');
        }
        if (profileType === 'emprendimiento' && configureBusinessNow && !acceptsCash && !acceptsTransfer) {
          throw new Error('Elegí al menos un medio de pago.');
        }
        if (
          profileType === 'emprendimiento' && configureBusinessNow &&
          (businessName.trim().length > 120 ||
            businessDescription.trim().length > 2000 ||
            businessLocation.trim().length > 180)
        ) throw new Error('Datos del emprendimiento demasiado largos');
        const normalizedCuit = bankCuit.replace(/\D/g, '');
        const selectedBankName = bankName === 'Otro' ? otherBankName.trim() : bankName.trim();
        if (profileType === 'emprendimiento' && configureBusinessNow && acceptsTransfer && (
          !selectedBankName ||
          !transferAlias.trim() ||
          !transferHolder.trim() ||
          !/^\d{11}$/.test(normalizedCuit)
        )) throw new Error('Datos de transferencia incompletos');
        if (profileType === 'emprendimiento' && configureBusinessNow && businessLogo && (
          !['image/jpeg', 'image/png', 'image/webp'].includes(businessLogo.type) ||
          businessLogo.size > 5 * 1024 * 1024
        )) throw new Error('Logo inválido');
        if (
          phone.trim().length > 16 ||
          otherBankName.trim().length > 120
        ) throw new Error('El teléfono no puede superar 16 caracteres y el nombre del banco 120.');
        const normalizedEmail = email.trim().toLowerCase();
        const hasPendingSetup = profileType === 'emprendimiento' && configureBusinessNow &&
          (businessLogo !== null || businessLatitude !== null || businessLongitude !== null);
        let pendingSetupSaved = false;
        if (hasPendingSetup) {
          try {
            await savePendingBusinessSetup({
              email: normalizedEmail,
              businessName: businessName.trim(),
              logo: businessLogo,
              latitude: businessLatitude,
              longitude: businessLongitude,
            });
            pendingSetupSaved = true;
          } catch (storageError) {
            console.error('No se pudo guardar localmente el logo o la ubicación opcional:', storageError);
          }
        }
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              full_name: name.trim(),
              ...(profileType === 'emprendimiento' && configureBusinessNow && dni.trim() ? { dni: dni.replace(/\D/g, '') } : {}),
              ...(profileType === 'emprendimiento' && configureBusinessNow ? { phone: normalizedPhone } : {}),
              enabled_panels: profileType === 'emprendimiento'
                ? ['emprendimiento', 'cliente']
                : ['cliente'],
              ...(profileType === 'emprendimiento' && !configureBusinessNow ? { business_setup_deferred: true } : {}),
              ...(profileType === 'emprendimiento' && configureBusinessNow ? {
                business_name: businessName.trim(),
                business_description: businessDescription.trim(),
                business_location: businessLocation.trim(),
                business_latitude: businessLatitude,
                business_longitude: businessLongitude,
                business_payment_methods: [
                  ...(acceptsCash ? ['cash'] : []),
                  ...(acceptsTransfer ? ['transfer'] : []),
                ],
                business_bank_name: acceptsTransfer ? selectedBankName : null,
                business_transfer_alias: acceptsTransfer ? transferAlias.trim() : null,
                business_transfer_holder: acceptsTransfer ? transferHolder.trim() : null,
                business_bank_cuit: acceptsTransfer ? normalizedCuit : null,
              } : {}),
            },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) {
          logSignupFailure(error);
          if (pendingSetupSaved) {
            try {
              await removePendingBusinessSetup(normalizedEmail);
            } catch (cleanupError) {
              console.error('No se pudo limpiar el guardado local tras fallar el registro:', cleanupError);
            }
          }
          throw error;
        }
        if (!data.user) {
          throw new Error('Registro sin usuario');
        }
        if (data.session && data.user) {
          await refreshProfile(data.user.id);
          navigate(returnTo, { replace: true });
        } else {
          setCanResendVerification(true);
          const confirmationHelp = 'Revisá tu correo y la carpeta de spam para confirmar la cuenta. Si no llega, usá “Reenviar correo de verificación”. Si esa dirección ya tenía cuenta, elegí “Ingresar” o recuperá tu contraseña.';
          setNotice(profileType === 'emprendimiento' && pendingSetupSaved
            ? `${confirmationHelp} Al ingresar por primera vez, el logo o la ubicación que elegiste se guardarán automáticamente en tu emprendimiento.`
            : profileType === 'emprendimiento' && hasPendingSetup
              ? `${confirmationHelp} No se pudo guardar el logo o la ubicación en este navegador; podés agregarlos más adelante desde tu panel.`
            : confirmationHelp);
        }
      } else if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
        await refreshProfile(data.user.id);
        const enabledPanels = data.user.user_metadata.enabled_panels;
        const defaultDestination = Array.isArray(enabledPanels) && enabledPanels.includes('emprendimiento')
          ? '/business'
          : '/';
        navigate(searchParams.get('next') || defaultDestination, { replace: true });
      } else if (session) {
        if (newPassword.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
        if (newPassword.length > 72) throw new Error('La nueva contraseña no puede superar 72 caracteres.');
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
        setMode('login');
        setPassword('');
        setNewPassword('');
        setNotice('Contraseña actualizada. Ya podés ingresar con tu nueva contraseña.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/login?recovery=1`,
        });
        if (error) throw error;
        setNotice('Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.');
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      if (/email not confirmed/i.test(message)) setCanResendVerification(true);
      if (/Teléfono inválido/.test(message)) setErrorMessage('Ingresá los 10 números de tu celular, por ejemplo 3804383816. Agregamos el prefijo de Argentina automáticamente.');
      else if (/nombre supera/.test(message)) setErrorMessage(message);
      else if (/correo supera/.test(message)) setErrorMessage(message);
      else if (/teléfono no puede superar/.test(message)) setErrorMessage(message);
      else if (/Datos del emprendimiento incompletos/.test(message)) setErrorMessage('Completá el nombre y la dirección de tu emprendimiento.');
      else if (/Datos del emprendimiento demasiado largos/.test(message)) setErrorMessage('Revisá los largos: nombre hasta 120, descripción hasta 2000 y dirección hasta 180 caracteres.');
      else if (/Datos de transferencia incompletos/.test(message)) setErrorMessage('Para aceptar transferencias, completá banco, alias, titular y un CUIT de 11 números.');
      else if (/Elegí al menos un medio de pago/.test(message)) setErrorMessage(message);
      else if (/Logo inválido/.test(message)) setErrorMessage('El logo debe ser JPG, PNG o WebP y pesar hasta 5 MB.');
      else if (/Datos de registro incompletos/.test(message)) setErrorMessage('Completá tu nombre, correo electrónico y una contraseña de al menos 8 caracteres.');
      else if (/nueva contraseña/.test(message)) setErrorMessage(message);
      else if (/correo electrónico.*formato|correo electrónico de tu cuenta|Ingresá tu correo|Ingresá el correo/i.test(message)) setErrorMessage(message);
      else if (/contraseña (es demasiado corta|supera el máximo)/i.test(message)) setErrorMessage(message);
      else if (/nombre completo/.test(message)) setErrorMessage(message);
      else if (/^[A-ZÁÉÍÓÚa-záéíóú].*largo permitido/.test(message)) setErrorMessage(message);
      else if (/largo permitido/.test(message)) setErrorMessage('Revisá los largos: nombre hasta 120, correo hasta 254, teléfono hasta 16, banco hasta 120 y contraseña hasta 72 caracteres.');
      else setErrorMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!supabase) {
      setErrorMessage('La autenticación no está disponible. Configurá Supabase.');
      return;
    }
    if (!validEmail.test(email.trim())) {
      setErrorMessage('Ingresá el correo electrónico de la cuenta para reenviar la confirmación.');
      return;
    }
    setResendingVerification(true);
    setErrorMessage('');
    setNotice('');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setNotice('Si la cuenta aún necesita confirmación, te enviaremos un nuevo enlace a ese correo.');
    } catch (caught) {
      setErrorMessage(messageFor(caught));
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleSignOut() {
    setErrorMessage('');
    try {
      await signOut();
      setNotice('Cerraste sesión correctamente.');
    } catch (caught) {
      setErrorMessage(messageFor(caught));
    }
  }

  const recoveryForm = mode === 'recover' && session;
  const formHeading = session && !recoveryForm
    ? 'Tu cuenta MORFI'
    : recoveryForm
      ? 'Elegí una contraseña nueva'
      : mode === 'register'
        ? 'Crear cuenta'
        : mode === 'recover'
          ? 'Recuperar contraseña'
          : 'Ingresar';

  return (
    <main className="min-h-screen bg-[#FFF3E5] px-4 py-10 text-[#8B3F14]">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm md:p-8">
        <Link to="/" className="font-semibold hover:underline">← Volver a MORFI</Link>
        <h1 className="mt-5 text-3xl font-black">{formHeading}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {session && !recoveryForm
            ? `Sesión iniciada${profile?.full_name ? ` para ${profile.full_name}` : ''}.`
            : 'Usá tu correo electrónico y contraseña para acceder a tu cuenta.'}
        </p>
        {!configured && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Falta configurar Supabase con VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY. No se puede iniciar sesión todavía.</p>}
        {session && !recoveryForm && <button type="button" onClick={() => void handleSignOut()} className="mt-4 rounded-xl border px-4 py-3 font-bold">Cerrar sesión</button>}
        {!session && mode !== 'recover' && (
          <div className="mt-5 flex gap-2">
            <button type="button" onClick={() => { setMode('login'); setErrorMessage(''); setNotice(''); }} className={`rounded-lg px-4 py-2 font-semibold ${mode === 'login' ? 'bg-[#8B3F14] text-white' : 'border'}`}>Ingresar</button>
            <button type="button" onClick={() => { setMode('register'); setErrorMessage(''); setNotice(''); }} className={`rounded-lg px-4 py-2 font-semibold ${mode === 'register' ? 'bg-[#8B3F14] text-white' : 'border'}`}>Registrarme</button>
          </div>
        )}
        {!session || recoveryForm ? (
          <form noValidate onSubmit={submit} className="mt-5 space-y-4">
            {mode === 'register' && <>
              <fieldset className="rounded-xl border p-3">
                <legend className="px-1 text-sm font-semibold">¿Qué cuenta querés crear?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={profileType === 'cliente'}
                    onClick={() => { setProfileType('cliente'); setErrorMessage(''); setNotice(''); }}
                    className={`rounded-lg px-3 py-3 text-left font-semibold ${profileType === 'cliente' ? 'bg-[#8B3F14] text-white' : 'border'}`}
                  >
                    Cliente
                    <span className="mt-1 block text-xs font-normal">Para descubrir y pedir productos</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={profileType === 'emprendimiento'}
                    onClick={() => { setProfileType('emprendimiento'); setErrorMessage(''); setNotice(''); }}
                    className={`rounded-lg px-3 py-3 text-left font-semibold ${profileType === 'emprendimiento' ? 'bg-[#8B3F14] text-white' : 'border'}`}
                  >
                    Emprendedor
                    <span className="mt-1 block text-xs font-normal">Para publicar y administrar tu negocio, y también comprar como cliente</span>
                  </button>
                </div>
              </fieldset>
              <label className="block text-sm font-semibold">Nombre completo<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={120} className={inputClass} required /></label>
              {profileType === 'emprendimiento' && <label className="flex items-center gap-3 rounded-xl border p-3 text-sm font-semibold"><input type="checkbox" checked={configureBusinessNow} onChange={event => setConfigureBusinessNow(event.target.checked)} />Quiero configurar mi emprendimiento ahora</label>}
              {profileType === 'emprendimiento' && !configureBusinessNow && <p className="text-sm text-gray-600">Podés crear tu cuenta con nombre, correo y contraseña. Al ingresar, te ayudamos a cargar el comercio, sus pagos y ubicación.</p>}
              {profileType === 'emprendimiento' && configureBusinessNow && <>
                <label className="block text-sm font-semibold">
                  DNI (opcional)
                  <input
                    value={dni}
                    onChange={event => setDni(event.target.value.replace(/\D/g, '').slice(0, 10))}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={10}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  WhatsApp público donde recibirás pedidos
                  <span className="mt-1 flex items-center rounded-xl border border-gray-300 bg-white">
                    <span className="px-3 text-sm text-gray-500">+54 9</span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={phone}
                      onChange={event => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="3804383816"
                      autoComplete="tel-national"
                      maxLength={10}
                      className="min-w-0 flex-1 rounded-r-xl p-3 text-base font-normal outline-none"
                      required
                    />
                  </span>
                  <span className="mt-1 block text-xs font-normal text-gray-500">Este WhatsApp se mostrará en el catálogo público para que los clientes puedan contactarte y enviarte pedidos. Ingresá los 10 números; el prefijo argentino se agrega automáticamente.</span>
                </label>
                <fieldset className="space-y-3 rounded-xl border p-3">
                  <legend className="px-1 text-sm font-semibold">Datos de tu emprendimiento</legend>
                  <label className="block text-sm font-semibold">
                    Nombre del emprendimiento
                    <input value={businessName} onChange={event => setBusinessName(event.target.value)} maxLength={120} className={inputClass} required />
                  </label>
                  <label className="block text-sm font-semibold">
                    Explicá brevemente lo que ofrecés
                    <textarea value={businessDescription} onChange={event => setBusinessDescription(event.target.value)} maxLength={2000} rows={3} className={inputClass} placeholder="Contá qué productos o servicios ofrecés" />
                  </label>
                  <label className="block text-sm font-semibold">
                    Dirección del punto de venta
                    <input value={businessLocation} onChange={event => setBusinessLocation(event.target.value)} maxLength={180} className={inputClass} placeholder="Calle, número, barrio y localidad" required />
                  </label>
                  <fieldset className="rounded-lg border p-3">
                    <legend className="px-1 text-sm font-semibold">Medios de pago</legend>
                    <label className="mt-2 flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={acceptsCash} onChange={event => setAcceptsCash(event.target.checked)} />
                      Acepto efectivo
                    </label>
                    <label className="mt-2 flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={acceptsTransfer} onChange={event => setAcceptsTransfer(event.target.checked)} />
                      Acepto transferencias
                    </label>
                    {acceptsTransfer && (
                    <div className="mt-3 grid gap-3">
                        <label className="block text-sm font-semibold">
                          Banco o billetera
                          <select value={bankName} onChange={event => setBankName(event.target.value)} className={inputClass} required>
                            <option value="">Elegí una opción</option>
                            {argentinePaymentProviders.map(provider => <option key={provider} value={provider}>{provider}</option>)}
                            <option value="Otro">Otro</option>
                          </select>
                        </label>
                        {bankName === 'Otro' && <label className="block text-sm font-semibold">Escribí el nombre<input value={otherBankName} onChange={event => setOtherBankName(event.target.value)} maxLength={120} className={inputClass} required /></label>}
                        <label className="block text-sm font-semibold">Alias<input value={transferAlias} onChange={event => setTransferAlias(event.target.value)} maxLength={120} className={inputClass} required /></label>
                        <label className="block text-sm font-semibold">Titular de la cuenta<input value={transferHolder} onChange={event => setTransferHolder(event.target.value)} maxLength={120} className={inputClass} required /></label>
                        <label className="block text-sm font-semibold">CUIT del titular<input inputMode="numeric" value={bankCuit} onChange={event => setBankCuit(event.target.value)} maxLength={13} className={inputClass} required /></label>
                    </div>
                    )}
                  </fieldset>
                  <div className="rounded-lg border p-3">
                    <p className="text-sm font-semibold">Logo del emprendimiento (opcional)</p>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={event => setBusinessLogo(event.target.files?.[0] ?? null)}
                      className="mt-2 block w-full text-sm"
                    />
                    {businessLogo && <p className="mt-1 text-xs text-gray-600">{businessLogo.name}</p>}
                    {businessLogoPreview && <img src={businessLogoPreview} alt="Vista previa del logo" className="mt-3 h-24 w-24 rounded-full border bg-white object-contain p-1" />}
                    <p className="mt-1 text-xs text-gray-600">Podés agregarlo ahora o más adelante desde tu panel. JPG, PNG o WebP, hasta 5 MB.</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-sm font-semibold">Ubicación GPS</p>
                    <button type="button" onClick={useBusinessLocation} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold">
                      Usar mi ubicación
                    </button>
                    {businessLocationNotice && <p role="status" className="mt-2 text-xs text-gray-600">{businessLocationNotice}</p>}
                    {businessLatitude !== null && businessLongitude !== null && (
                      <>
                        <p className="mt-1 text-xs text-gray-600">Ubicación lista; se guardará al ingresar a tu cuenta.</p>
                        <BusinessLocationMap latitude={businessLatitude} longitude={businessLongitude} />
                      </>
                    )}
                  </div>
                </fieldset>
              </>}
            </>}
            {mode !== 'recover' && !recoveryForm && (
              <>
                <label className="block text-sm font-semibold">Correo electrónico<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" maxLength={254} className={inputClass} required /></label>
                <label className="block text-sm font-semibold">
                  Contraseña
                  <span className="mt-1 flex rounded-xl border border-gray-300 bg-white">
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} maxLength={72} aria-describedby={mode === 'register' ? 'password-help' : undefined} className="min-w-0 flex-1 rounded-l-xl p-3 text-base font-normal outline-none" minLength={mode === 'register' ? 8 : undefined} required />
                    <button type="button" onClick={() => setShowPassword(visible => !visible)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="flex items-center gap-1 px-3 text-sm font-semibold">
                      {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                      {showPassword ? 'Ocultar' : 'Ver'}
                    </button>
                  </span>
                  {mode === 'register' && <span id="password-help" className="mt-1 block text-sm font-normal text-gray-600">Usá entre 8 y 72 caracteres. Combiná mayúsculas, minúsculas, números y un símbolo. Evitá tu DNI y contraseñas conocidas.</span>}
                </label>
              </>
            )}
            {(mode === 'recover' || recoveryForm) && (
              <>
                {!recoveryForm && <label className="block text-sm font-semibold">Correo electrónico<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className={inputClass} required /></label>}
                {recoveryForm && (
                  <label className="block text-sm font-semibold">
                    Nueva contraseña
                    <span className="mt-1 flex rounded-xl border border-gray-300 bg-white">
                      <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" maxLength={72} aria-describedby="new-password-help" className="min-w-0 flex-1 rounded-l-xl p-3 text-base font-normal outline-none" minLength={8} required />
                      <button type="button" onClick={() => setShowNewPassword(visible => !visible)} aria-label={showNewPassword ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'} className="flex items-center gap-1 px-3 text-sm font-semibold">
                        {showNewPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                        {showNewPassword ? 'Ocultar' : 'Ver'}
                      </button>
                    </span>
                    <span id="new-password-help" className="mt-1 block text-sm font-normal text-gray-600">Usá entre 8 y 72 caracteres con mayúsculas, minúsculas, números y un símbolo.</span>
                  </label>
                )}
              </>
            )}
            {errorMessage && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{errorMessage}</p>}
            {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">{notice}</p>}
            <button disabled={busy || !configured} className="w-full rounded-xl bg-[#F07821] p-3 font-bold text-white disabled:opacity-50">
              {busy ? 'Procesando…' : recoveryForm ? 'Guardar contraseña nueva' : mode === 'register' ? 'Crear cuenta' : mode === 'recover' ? 'Enviar enlace de recuperación' : 'Ingresar'}
            </button>
            {mode === 'login' && <button type="button" onClick={() => { setMode('recover'); setErrorMessage(''); setNotice(''); }} className="w-full py-2 text-sm font-semibold underline">Olvidé mi contraseña</button>}
            {canResendVerification && (mode === 'login' || mode === 'register') && (
              <button
                type="button"
                onClick={() => void resendVerification()}
                disabled={resendingVerification || !configured}
                className="w-full py-2 text-sm font-semibold underline disabled:opacity-50"
              >
                {resendingVerification ? 'Enviando…' : 'Reenviar correo de verificación'}
              </button>
            )}
            {mode === 'recover' && !recoveryForm && <button type="button" onClick={() => { setMode('login'); setErrorMessage(''); setNotice(''); }} className="w-full py-2 text-sm font-semibold underline">Volver a ingresar</button>}
          </form>
        ) : (
          <>
            {notice && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">{notice}</p>}
            {errorMessage && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{errorMessage}</p>}
          </>
        )}
      </section>
    </main>
  );
}
