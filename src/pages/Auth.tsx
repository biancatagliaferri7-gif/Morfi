import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../AuthContext';

type AuthMode = 'login' | 'register' | 'recover';
type Panel = 'cliente' | 'emprendimiento' | 'ahorro';

const inputClass = 'mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 text-base font-normal';

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/invalid login credentials|invalid credentials/i.test(message)) return 'El correo o la contraseña no son correctos.';
  if (/email not confirmed/i.test(message)) return 'Confirmá tu correo desde el enlace que te enviamos antes de ingresar.';
  if (/already registered|already exists|user already registered/i.test(message)) return 'Ese correo ya tiene una cuenta. Elegí “Ingresar” para continuar.';
  if (/password.*(weak|short)|should be at least/i.test(message)) return 'La contraseña debe tener al menos 8 caracteres.';
  if (/rate limit|too many requests/i.test(message)) return 'Se realizaron demasiados intentos. Esperá unos minutos e intentá de nuevo.';
  if (/email.*(smtp|provider|send)/i.test(message)) return 'No se pudo enviar el correo. Revisá que el proveedor Email y el envío de correos estén configurados en Supabase.';
  if (/fetch|network/i.test(message)) return 'No se pudo conectar con Supabase. Revisá la URL y tu conexión a internet.';
  return 'No se pudo completar la operación. Revisá los datos e intentá nuevamente.';
}

export default function Auth({ initialMode }: { initialMode: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [panelsSelected, setPanelsSelected] = useState<Panel[]>(['cliente']);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const { configured, session, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('next') || (panelsSelected.includes('emprendimiento') ? '/business' : '/');

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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setErrorMessage('La autenticación no está disponible. Configurá la URL y la clave pública de Supabase.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      if (mode === 'register') {
        if (!name.trim() || password.length < 8) throw new Error('Datos de registro incompletos');
        if (
          name.trim().length > 120 ||
          email.trim().length > 254 ||
          password.length > 72
        ) throw new Error('Algún dato supera el largo permitido');
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: name.trim(),
              enabled_panels: panelsSelected,
            },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });
        if (error) throw error;
        if (data.session && data.user) {
          await refreshProfile(data.user.id);
          navigate(returnTo, { replace: true });
        } else {
          setNotice('Te enviamos un correo para confirmar tu cuenta. Abrí el enlace y después ingresá con tu correo y contraseña.');
        }
      } else if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        await refreshProfile(data.user.id);
        navigate(returnTo, { replace: true });
      } else if (session) {
        if (newPassword.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
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
      if (/Datos de registro incompletos/.test(message)) setErrorMessage('Completá tu nombre y elegí una contraseña de al menos 8 caracteres.');
      else if (/largo permitido/.test(message)) setErrorMessage('El nombre admite hasta 120 caracteres y la contraseña hasta 72.');
      else if (/DNI|unique/i.test(message)) setErrorMessage('Ese DNI ya está registrado o no es válido. Revisá el número.');
      else setErrorMessage(messageFor(caught));
    } finally {
      setBusy(false);
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

  function toggleSellerPanel() {
    setPanelsSelected(current => current.includes('emprendimiento')
      ? ['cliente']
      : ['cliente', 'emprendimiento']);
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
            : 'Usá tu correo y contraseña. Solo te pedimos los datos necesarios para empezar.'}
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
          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === 'register' && <>
              <label className="block text-sm font-semibold">Nombre<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={120} className={inputClass} required /></label>
              <label className="flex items-center gap-3 rounded-xl border border-[#E8C9AA] p-3 text-sm font-semibold"><input type="checkbox" checked={panelsSelected.includes('emprendimiento')} onChange={toggleSellerPanel} />También quiero vender en MORFI</label>
              {panelsSelected.includes('emprendimiento') && <p className="rounded-xl bg-[#FFF3E5] p-3 text-sm text-[#77553C]">Después de crear tu cuenta podrás registrar tu emprendimiento y cargar el primer producto. Los datos de cobro y entrega se completan cuando los necesites.</p>}
            </>}
            {mode !== 'recover' && !recoveryForm && (
              <>
                <label className="block text-sm font-semibold">Correo electrónico<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" maxLength={254} className={inputClass} required /></label>
                <label className="block text-sm font-semibold">Contraseña<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} maxLength={72} className={inputClass} minLength={8} required /></label>
              </>
            )}
            {(mode === 'recover' || recoveryForm) && (
              <>
                {!recoveryForm && <label className="block text-sm font-semibold">Correo electrónico<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className={inputClass} required /></label>}
                {recoveryForm && <label className="block text-sm font-semibold">Nueva contraseña<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" className={inputClass} minLength={8} required /></label>}
              </>
            )}
            {errorMessage && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{errorMessage}</p>}
            {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">{notice}</p>}
            <button disabled={busy || !configured} className="w-full rounded-xl bg-[#F07821] p-3 font-bold text-white disabled:opacity-50">
              {busy ? 'Procesando…' : recoveryForm ? 'Guardar contraseña nueva' : mode === 'register' ? 'Crear cuenta' : mode === 'recover' ? 'Enviar enlace de recuperación' : 'Ingresar'}
            </button>
            {mode === 'login' && <button type="button" onClick={() => { setMode('recover'); setErrorMessage(''); setNotice(''); }} className="w-full py-2 text-sm font-semibold underline">Olvidé mi contraseña</button>}
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
