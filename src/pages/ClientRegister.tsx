import { safeReturnPath } from "../auth/returnPath";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../AuthContext";
import { fieldClass, primaryClass, setupError } from "../business/sellerSetup";
export default function ClientRegister() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const next = params.get("next");
  const safeNext = safeReturnPath(next, "/hungry");
  if (params.get("profile") === "emprendimiento")
    return <Navigate to="/register/emprendedor" replace />;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { full_name: name.trim(), enabled_panels: ["cliente"] },
          emailRedirectTo: `${location.origin}/auth/callback`,
        },
      });
      if (r.error) throw r.error;
      if (r.data.session) {
        await refreshProfile(r.data.user!.id);
        navigate(safeNext, { replace: true });
      } else
        setNotice(
          "La cuenta requiere confirmación. Revisá tu correo o ingresá si ya tenías una cuenta.",
        );
      setPassword("");
    } catch (err) {
      setError(setupError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-[#FFF3E5] px-4 py-8 text-[#8B3F14]">
      <section className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-sm">
        <Link to="/">← Volver a MORFI</Link>
        <h1 className="mt-5 text-3xl font-black">Registrate para pedir</h1>
        <p className="mt-2 text-gray-600">
          Descubrí los emprendimientos de tu barrio.
        </p>
        {session ? (
          <Link className={primaryClass + " mt-6 inline-block"} to={safeNext}>
            Continuar con mi cuenta
          </Link>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={(e) => void submit(e)}>
            <label className="block font-semibold">
              Nombre y apellido
              <input
                className={fieldClass}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                minLength={2}
                required
              />
            </label>
            <label className="block font-semibold">
              Correo electrónico
              <input
                className={fieldClass}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                required
              />
            </label>
            <label className="block font-semibold">
              Contraseña
              <input
                className={fieldClass}
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                maxLength={72}
                aria-describedby="client-password-help"
                required
              />
            </label>
            <button
              className="min-h-11 text-sm font-semibold underline"
              type="button"
              onClick={() => setVisible(!visible)}
            >
              {visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            </button>
            <p id="client-password-help" className="text-sm text-gray-600">
              Entre 8 y 72 caracteres. Combiná mayúsculas, minúsculas, números y
              un símbolo.
            </p>
            {error && (
              <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            <button
              disabled={busy || !supabase}
              className={primaryClass + " w-full"}
            >
              {busy ? "Creando cuenta…" : "Crear mi cuenta"}
            </button>
            <Link
              className="block py-2 text-center font-semibold underline"
              to={"/login?next=" + encodeURIComponent(safeNext)}
            >
              Ya tengo cuenta: ingresar
            </Link>
          </form>
        )}
        <div className="mt-8 border-t border-orange-100 pt-5">
          <p className="font-bold">¿Tenés un emprendimiento?</p>
          <Link
            className="mt-3 flex min-h-12 items-center justify-center rounded-xl border-2 border-[#B94E12] px-4 text-center font-bold"
            to="/register/emprendedor"
          >
            Registrate como emprendedor
          </Link>
        </div>
      </section>
    </main>
  );
}
