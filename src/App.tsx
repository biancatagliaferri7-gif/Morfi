import React, {lazy,Suspense,useState,useEffect} from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Hungry from './pages/Hungry';
const Business=lazy(()=>import('./pages/Business'));
import Savings from './pages/Savings';
import Auth from './pages/Auth';
import ClientRegister from './pages/ClientRegister';
const SellerRegister=lazy(()=>import('./pages/SellerRegister'));
import EmailVerification from './pages/EmailVerification';
import { AuthProvider, useAuth } from './AuthContext';

/* ─── SVG Icons ──────────────────────────────────────────────── */
const IconHome = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const IconFork = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="2" x2="8" y2="9"/>
    <line x1="12" y1="2" x2="12" y2="9"/>
    <path d="M8 9 Q8 14 10 15 L10 22"/>
    <line x1="16" y1="2" x2="16" y2="22"/>
  </svg>
);

const IconStore = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1-4h16l1 4"/>
    <path d="M3 9a2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2"/>
    <path d="M5 21V11m14 10V11"/>
    <rect x="9" y="15" width="6" height="6" rx="1"/>
  </svg>
);

const IconUser = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

const IconMenu = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
    <line x1="4" y1="6" x2="20" y2="6"/>
    <line x1="4" y1="12" x2="20" y2="12"/>
    <line x1="4" y1="18" x2="20" y2="18"/>
  </svg>
);

/* ─── MORFI logo ─────────────────────────────────────────────── */
export const MorfiLogoSVG: React.FC<{ size?: number }> = ({ size = 44 }) => (
  <img
    src="/MORFI_logo_naranja_transparente.png"
    alt="MORFI"
    width={size * 1089 / 994}
    height={size}
    className="h-auto max-h-full max-w-full shrink-0 object-contain"
  />
);

/* ─── Desktop Header ─────────────────────────────────────────── */
const DesktopHeader: React.FC = () => {
  const location = useLocation();
  const { session, profile, signOut, isSeller } = useAuth();
  const closeSession = () => {
    void signOut().catch(() => window.alert('No se pudo cerrar la sesión. Intentá nuevamente.'));
  };

  const navLinks = [
    { to: '/', label: 'Inicio', icon: <IconHome className="w-5 h-5 mx-auto mb-0.5"/> },
    { to: '/hungry', label: 'Tengo hambre', icon: <IconFork className="w-5 h-5 mx-auto mb-0.5"/> },
    ...(session && isSeller ? [{ to: '/business', label: 'Mi emprendimiento', icon: <IconStore className="w-5 h-5 mx-auto mb-0.5"/> }] : []),
  ];

  return (
    <header className="hidden md:flex items-center px-6 py-2 bg-white sticky top-0 z-50 shadow-sm border-b border-[#F2DDCA] gap-8">
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2 no-underline flex-shrink-0">
        <MorfiLogoSVG size={42} />
      </Link>

      {/* Nav links with icons above */}
      <nav className="flex items-end gap-6 flex-1 justify-center">
        {navLinks.map(({ to, label, icon }) => {
          const active = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center no-underline transition-colors text-xs font-semibold pb-1 border-b-2 ${
                active
                  ? 'text-[#C25B19] border-[#F07821]'
                  : 'text-[#693416] border-transparent hover:text-[#C25B19]'
              }`}
            >
              {icon}
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Auth */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {session ? (
          <>
            <span className="text-sm font-semibold">{profile?.full_name || 'Cuenta verificada'}</span>
            <button onClick={closeSession} className="rounded-full border border-[#E8C9AA] px-4 py-2 text-sm font-semibold">Salir</button>
          </>
        ) : (
          <>
            <Link to="/login" className="flex items-center gap-1.5 px-5 py-2 rounded-full border border-[#E8C9AA] text-[#8B3F14] text-sm font-semibold hover:bg-[#FFF3E5] transition-colors no-underline">
              <IconUser className="w-4 h-4"/> Ingresar
            </Link>
            <Link to="/register" className="px-5 py-2 rounded-full bg-[#F07821] text-white text-sm font-bold hover:bg-[#C25B19] transition-all no-underline">Registrarse</Link>
          </>
        )}
      </div>
    </header>
  );
};

/* ─── Mobile Header ──────────────────────────────────────────── */
const MobileHeader: React.FC = () => {
  const { session, signOut, isSeller } = useAuth();
  const [menuOpen,setMenuOpen]=useState(false);
  const closeSession = () => {
    void signOut().catch(() => window.alert('No se pudo cerrar la sesión. Intentá nuevamente.'));
  };
  return <header className="flex md:hidden items-center justify-between px-4 py-2.5 bg-white sticky top-0 z-50 border-b border-[#F2DDCA]">
    <button className="text-[#8B3F14] p-3" aria-label="Menú" aria-expanded={menuOpen} aria-controls="mobile-menu" onClick={()=>setMenuOpen(!menuOpen)}>
      <IconMenu className="w-6 h-6"/>
    </button>
    <Link to="/" className="flex items-center gap-2 no-underline">
      <MorfiLogoSVG size={34} />
    </Link>
    {session
      ? <button onClick={closeSession} className="text-xs font-semibold text-[#8B3F14]">Salir</button>
      : <Link to="/login" className="text-[#8B3F14] p-1" aria-label="Ingresar"><IconUser className="w-6 h-6"/></Link>}
    {menuOpen&&<nav id="mobile-menu" aria-label="Menú principal" className="absolute left-0 right-0 top-full border-b border-orange-100 bg-white p-4 shadow-sm" onClick={()=>setMenuOpen(false)}><Link className="block min-h-12 py-3 font-semibold" to="/">Inicio</Link><Link className="block min-h-12 py-3 font-semibold" to="/hungry">Tengo hambre</Link>{session&&isSeller&&<Link className="block min-h-12 py-3 font-semibold" to="/business">Mi emprendimiento</Link>}{!session&&<Link className="block min-h-12 py-3 font-semibold" to="/register">Registrarse</Link>}</nav>}
  </header>;
};

/* ─── Mobile Bottom Nav ──────────────────────────────────────── */
const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  const {session,isSeller}=useAuth();

  const tabs = [
    { to: '/', label: 'Inicio', icon: (c: string) => <IconHome className={c}/> },
    { to: '/hungry', label: 'Tengo hambre', icon: (c: string) => <IconFork className={c}/> },
    ...(session && isSeller ? [{ to: '/business', label: 'Mi emprendimiento', icon: (c: string) => <IconStore className={c}/> }] : []),
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#F2DDCA] flex shadow-[0_-4px_16px_rgba(74,38,12,0.08)]">
      {tabs.map(({ to, label, icon }) => {
        const active = location.pathname === to;
        return (
          <Link
            key={to}
            to={to}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 no-underline transition-colors ${
              active ? 'text-[#C25B19]' : 'text-[#8B3F14] hover:text-[#C25B19]'
            }`}
          >
            {icon('w-5 h-5')}
            <span className="text-[9px] font-semibold leading-tight text-center">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

/* ─── App ────────────────────────────────────────────────────── */
const SellerGate: React.FC<{children:React.ReactNode}> = ({children}) => {
 const {loading,session,isSeller}=useAuth();
 if(loading)return <p className="p-8" role="status">Verificando tu sesión…</p>;
 if(!session)return <Navigate to={'/login?next='+encodeURIComponent(location.pathname+location.search)} replace/>;
 if(!isSeller)return <Navigate to="/register/emprendedor" replace/>;
 return <>{children}</>;
};
const AccountRedirect:React.FC=()=>{
 const {loading,isSeller,sellerSetupPending}=useAuth();
 if(loading)return <p className="p-8">Ingresando…</p>;
 return <Navigate to={isSeller?'/business':sellerSetupPending?'/register/emprendedor':'/hungry'} replace/>;
};

const PageScroll:React.FC=()=>{
  const route=useLocation();
  useEffect(()=>{window.scrollTo(0,0);},[route.pathname]);
  return null;
};

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <PageScroll/>
      <div className="flex flex-col min-h-screen bg-white">
        <MobileHeader />
        <DesktopHeader />
        <div className="flex-1 pb-16 md:pb-0">
          <Suspense fallback={<p role="status" className="p-8">Cargando…</p>}><Routes>
            <Route path="/" element={<Home />} />
            <Route path="/hungry" element={<Hungry />} />
            <Route path="/business" element={<SellerGate><Business /></SellerGate>} />
            <Route path="/savings" element={<Savings />} />
            <Route path="/login" element={<Auth initialMode="login" />} />
            <Route path="/register" element={<ClientRegister />} />
            <Route path="/register/emprendedor" element={<SellerRegister />} />
            <Route path="/business/branches/new" element={<SellerGate><SellerRegister branch /></SellerGate>} />
            <Route path="/account" element={<AccountRedirect />} />
            <Route path="/auth/callback" element={<EmailVerification />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes></Suspense>
        </div>
        <MobileBottomNav />
      </div>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
