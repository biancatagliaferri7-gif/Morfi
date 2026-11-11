import { safeReturnPath } from "../auth/returnPath";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../AuthContext";
import { authErrorMessage } from "../auth/authErrors";
import { fieldClass, primaryClass } from "../business/sellerSetup";
export default function Auth({
  initialMode,
}: {
  initialMode: "login" | "register" | "recover";
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session, loading, refreshProfile, signOut } = useAuth();
  const [recover, setRecover] = useState(
    initialMode === "recover" || params.get("recovery") === "1",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resend, setResend] = useState(false);
  const next = params.get("next");
  const destination = safeReturnPath(next, "/account");
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecover(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session && !loading && !recover)
      navigate(destination, { replace: true });
  }, [session, loading, recover, destination, navigate]);
  if (initialMode === "register") return <Navigate to="/register" replace />;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (recover && session) {
        const r = await supabase.auth.updateUser({ password });
        if (r.error) throw r.error;
        await signOut();
        setPassword("");
        setRecover(false);
        setNotice("Contraseña actualizada. Ya podés ingresar.");
      } else if (recover) {
        const r = await supabase.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          { redirectTo: location.origin + "/login?recovery=1" },
        );
        if (r.error) throw r.error;
        setNotice(
          "Si la cuenta existe y el envío de correos está disponible, recibirás un enlace para recuperar el acceso.",
        );
      } else {
        const r = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (r.error) {
          if (/email not confirmed/i.test(r.error.message)) setResend(true);
          throw r.error;
        }
        await refreshProfile(r.data.user.id);
        navigate(destination, { replace: true });
      }
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function resendEmail() {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const r = await supabase.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: location.origin + "/auth/callback" },
      });
      if (r.error) throw r.error;
      setNotice("Solicitud enviada. Revisá tu correo y la carpeta de spam.");
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-[#FFF3E5] px-4 py-8 text-[#8B3F14]">
      <section className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-sm">
        <Link to="/">← Volver a MORFI</Link>
        <h1 className="mt-5 text-3xl font-black">
          {recover
            ? session
              ? "Elegí una contraseña nueva"
              : "Recuperar contraseña"
            : "Ingresar"}
        </h1>
        <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
          {!(recover && session) && (
            <label className="block font-semibold">
              Correo electrónico
              <input
                className={fieldClass}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
          )}
          {(!recover || session) && (
            <>
              <label className="block font-semibold">
                {recover ? "Nueva contraseña" : "Contraseña"}
                <input
                  className={fieldClass}
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={recover ? "new-password" : "current-password"}
                  minLength={recover ? 8 : undefined}
                  maxLength={72}
                  required
                />
              </label>
              <button
                className="min-h-11 underline"
                type="button"
                onClick={() => setVisible(!visible)}
              >
                {visible ? "Ocultar" : "Mostrar"} contraseña
              </button>
              {recover && (
                <p className="text-sm">
                  Usá mayúsculas, minúsculas, números y un símbolo.
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-xl bg-green-50 p-3">
              {notice}
            </p>
          )}
          <button
            className={primaryClass + " w-full"}
            disabled={busy || !supabase}
          >
            {busy
              ? "Procesando…"
              : recover
                ? session
                  ? "Guardar contraseña nueva"
                  : "Enviar enlace de recuperación"
                : "Ingresar"}
          </button>
          {!recover && (
            <button
              type="button"
              className="min-h-11 w-full underline"
              onClick={() => {
                setRecover(true);
                setError("");
                setPassword("");
              }}
            >
              Olvidé mi contraseña
            </button>
          )}
          {resend && !recover && (
            <button
              type="button"
              className="min-h-11 w-full underline"
              disabled={busy}
              onClick={() => void resendEmail()}
            >
              Reenviar correo de verificación
            </button>
          )}
          {recover && (
            <button
              type="button"
              className="min-h-11 w-full underline"
              onClick={() => {
                setRecover(false);
                setError("");
              }}
            >
              Volver a ingresar
            </button>
          )}
          <Link
            className="block min-h-11 py-2 text-center font-bold underline"
            to={
              "/register" +
              (next ? "?next=" + encodeURIComponent(destination) : "")
            }
          >
            Crear una cuenta
          </Link>
        </form>
      </section>
    </main>
  );
}
