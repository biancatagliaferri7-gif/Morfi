import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Hungry from './pages/Hungry';
import Business from './pages/Business';
import Savings from './pages/Savings';

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

const IconCart = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
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

/* ─── MORFI Logo SVG (inline, reusable) ─────────────────────── */
export const MorfiLogoSVG: React.FC<{ size?: number }> = ({ size = 44 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Chef hat dome */}
    <circle cx="38" cy="34" r="14" fill="white"/>
    <circle cx="50" cy="28" r="17" fill="white"/>
    <circle cx="62" cy="34" r="14" fill="white"/>
    {/* Hat brim */}
    <rect x="29" y="44" width="42" height="10" rx="5" fill="#B9E769"/>
    {/* Hat body fill (between circles and brim) */}
    <rect x="30" y="34" width="40" height="16" fill="white"/>
    {/* Fork left */}
    <line x1="38" y1="56" x2="38" y2="76" stroke="#173D2B" strokeWidth="3.5" strokeLinecap="round"/>
    <line x1="35" y1="56" x2="35" y2="63" stroke="#173D2B" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="41" y1="56" x2="41" y2="63" stroke="#173D2B" strokeWidth="2.5" strokeLinecap="round"/>
    {/* Spoon right */}
    <ellipse cx="62" cy="61" rx="5" ry="6.5" fill="#173D2B"/>
    <line x1="62" y1="67" x2="62" y2="76" stroke="#173D2B" strokeWidth="3.5" strokeLinecap="round"/>
  </svg>
);

/* ─── Desktop Header ─────────────────────────────────────────── */
const DesktopHeader: React.FC = () => {
  const location = useLocation();

  const navLinks = [
    { to: '/', label: 'Inicio', icon: <IconHome className="w-5 h-5 mx-auto mb-0.5"/> },
    { to: '/hungry', label: 'Tengo hambre', icon: <IconFork className="w-5 h-5 mx-auto mb-0.5"/> },
    { to: '/business', label: 'Mi emprendimiento', icon: <IconStore className="w-5 h-5 mx-auto mb-0.5"/> },
    { to: '/savings', label: 'Ahorro', icon: <IconCart className="w-5 h-5 mx-auto mb-0.5"/> },
  ];

  return (
    <header className="hidden md:flex items-center px-6 py-2 bg-[#173D2B] sticky top-0 z-50 shadow-lg gap-8">
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2 no-underline flex-shrink-0">
        <MorfiLogoSVG size={42} />
        <span className="text-white text-2xl font-black tracking-widest" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
          MORFI
        </span>
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
                  ? 'text-[#B9E769] border-[#B9E769]'
                  : 'text-white border-transparent hover:text-[#B9E769]'
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
        <Link
          to="/login"
          className="flex items-center gap-1.5 px-5 py-2 rounded-full border border-white text-white text-sm font-semibold hover:bg-white hover:text-[#173D2B] transition-colors no-underline"
        >
          <IconUser className="w-4 h-4"/>
          Ingresar
        </Link>
        <Link
          to="/register"
          className="px-5 py-2 rounded-full bg-[#B9E769] text-[#173D2B] text-sm font-bold hover:brightness-95 transition-all no-underline"
        >
          Registrarse
        </Link>
      </div>
    </header>
  );
};

/* ─── Mobile Header ──────────────────────────────────────────── */
const MobileHeader: React.FC = () => (
  <header className="flex md:hidden items-center justify-between px-4 py-2.5 bg-[#173D2B] sticky top-0 z-50">
    <button className="text-white p-1" aria-label="Menú">
      <IconMenu className="w-6 h-6"/>
    </button>
    <Link to="/" className="flex items-center gap-2 no-underline">
      <MorfiLogoSVG size={34} />
      <span className="text-white text-xl font-black tracking-widest">MORFI</span>
    </Link>
    <button className="text-white p-1" aria-label="Perfil">
      <IconUser className="w-6 h-6"/>
    </button>
  </header>
);

/* ─── Mobile Bottom Nav ──────────────────────────────────────── */
const MobileBottomNav: React.FC = () => {
  const location = useLocation();

  const tabs = [
    { to: '/', label: 'Inicio', icon: (c: string) => <IconHome className={c}/> },
    { to: '/hungry', label: 'Tengo hambre', icon: (c: string) => <IconFork className={c}/> },
    { to: '/business', label: 'Emprendimiento', icon: (c: string) => <IconStore className={c}/> },
    { to: '/savings', label: 'Ahorro', icon: (c: string) => <IconCart className={c}/> },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#173D2B] border-t border-[#0F2A1D] flex">
      {tabs.map(({ to, label, icon }) => {
        const active = location.pathname === to;
        return (
          <Link
            key={to}
            to={to}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 no-underline transition-colors ${
              active ? 'text-[#B9E769]' : 'text-[#7BAB8B] hover:text-white'
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
const App: React.FC = () => (
  <BrowserRouter>
    <div className="flex flex-col min-h-screen bg-white">
      <MobileHeader />
      <DesktopHeader />
      <main className="flex-1 pb-16 md:pb-0">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/hungry" element={<Hungry />} />
          <Route path="/business" element={<Business />} />
          <Route path="/savings" element={<Savings />} />
          <Route path="/login" element={<div className="p-8 text-center text-[#173D2B] font-semibold">Página de ingreso (demo)</div>} />
          <Route path="/register" element={<div className="p-8 text-center text-[#173D2B] font-semibold">Página de registro (demo)</div>} />
        </Routes>
      </main>
      <MobileBottomNav />
    </div>
  </BrowserRouter>
);

export default App;
