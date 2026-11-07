import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { supabase } from '../lib/supabaseClient';

const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function verificationErrorMessage(code: string | null) {
  if (code === 'otp_expired' || code === 'access_denied') {
    return 'El enlace de confirmación venció o ya no es válido. Podés pedir uno nuevo.';
  }
  return 'No se pudo validar el enlace de confirmación. Revisá que hayas abierto el enlace más reciente.';
}

export default function EmailVerification() {
  const { loading, session } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const errorCode = searchParams.get('error_code') || hashParams.get('error_code');
  const errorDescription = searchParams.get('error_description') || hashParams.get('error_description');
  const hasConfirmationResult =
    searchParams.get('type') === 'signup' || hashParams.get('type') === 'signup';
  const isExpired = errorCode === 'otp_expired' || /expired|expir/i.test(errorDescription ?? '');
  const isVerified = !errorCode && !errorDescription &&
    Boolean(session?.user.email_confirmed_at || session?.user.confirmed_at);
  const isVerifiedWithoutSession = !loading && !session && hasConfirmationResult && !errorCode;
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function resendConfirmation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setError('');
    if (!validEmail.test(email.trim())) {
      setError('Ingresá un correo electrónico válido.');
      return;
    }
    if (!supabase) {
      setError('La autenticación no está disponible. Revisá la configuración de Supabase.');
      return;
    }

    setBusy(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (resendError) throw resendError;
      setNotice('Si la cuenta aún necesita confirmación, te enviaremos un nuevo enlace a ese correo.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo reenviar el correo.');
    } finally {
      setBusy(false);
    }
  }

  const enabledPanels = session?.user.user_metadata.enabled_panels;
  const destination =
    Array.isArray(enabledPanels) && enabledPanels.includes('emprendimiento')
      ? '/business'
      : '/hungry';

  return (
    <main className="min-h-screen bg-[#FFF3E5] px-4 py-10 text-[#8B3F14]">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm md:p-8">
        <Link to="/" className="font-semibold hover:underline">← Volver a MORFI</Link>
        <h1 className="mt-5 text-3xl font-black">Confirmación de cuenta</h1>

        {loading ? (
          <p role="status" className="mt-4 rounded-xl bg-orange-50 p-4">Estamos verificando tu enlace seguro…</p>
        ) : isVerified ? (
          <div className="mt-4 space-y-4">
            <p role="status" className="rounded-xl bg-green-50 p-4 font-semibold text-green-800">
              ¡Tu cuenta fue verificada correctamente! Ya podés ingresar a MORFI
            </p>
            <Link to={destination} className="block rounded-xl bg-[#F07821] p-3 text-center font-bold text-white no-underline">
              Continuar a MORFI
            </Link>
          </div>
        ) : isVerifiedWithoutSession ? (
          <div className="mt-4 space-y-4">
            <p role="status" className="rounded-xl bg-green-50 p-4 font-semibold text-green-800">
              ¡Tu cuenta fue verificada correctamente! Ya podés ingresar a MORFI
            </p>
            <p className="text-sm text-gray-600">Por seguridad, no se pudo iniciar una sesión en este navegador.</p>
            <Link to="/login" className="block rounded-xl bg-[#F07821] p-3 text-center font-bold text-white no-underline">
              Iniciar sesión
            </Link>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">
              {verificationErrorMessage(errorCode)}
            </p>
            {!isExpired && (
              <Link to="/login" className="block rounded-xl border border-[#E8C9AA] p-3 text-center font-bold text-[#8B3F14] no-underline">
                Iniciar sesión
              </Link>
            )}
            <form onSubmit={resendConfirmation} className="space-y-3 border-t border-orange-100 pt-4">
              <p className="text-sm text-gray-600">Si el enlace venció, solicitá uno nuevo:</p>
              <label className="block text-sm font-semibold">
                Correo electrónico
                <input
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={254}
                  required
                  className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal"
                />
              </label>
              {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
              {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
              <button disabled={busy} className="w-full rounded-xl bg-[#F07821] p-3 font-bold text-white disabled:opacity-50">
                {busy ? 'Enviando…' : 'Reenviar verificación'}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
