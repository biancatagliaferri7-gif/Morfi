import React from 'react';
import { Link } from 'react-router-dom';

/* ─── Icon helpers (reused from App but self-contained) ─────── */
const ArrowRight = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="12 5 19 12 12 19"/>
  </svg>
);

const IconCloche = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 14h20"/>
    <path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/>
    <path d="M6 14v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1"/>
  </svg>
);

const IconStore = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1-4h16l1 4"/>
    <path d="M3 9a2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2"/>
    <path d="M5 21V11m14 10V11"/>
    <rect x="9" y="15" width="6" height="6" rx="1"/>
  </svg>
);

const IconCart = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
);

/* ─── Tick decoration (reference has these in top-right of hero) */
const TickDecoration = () => (
  <div className="absolute top-6 right-6 md:top-10 md:right-10 flex flex-col items-end gap-1 z-20 pointer-events-none">
    <div className="w-6 h-1.5 bg-[#F6A623] rounded-full"/>
    <div className="w-4 h-1.5 bg-[#F6A623] rounded-full"/>
    <div className="w-2 h-1.5 bg-[#F6A623] rounded-full"/>
  </div>
);

/* ─── Orange accent ticks next to MORFI logo ────────────────── */
const TitleTicks = () => (
  <span className="inline-flex flex-col gap-0.5 ml-2 mb-1 align-bottom">
    <span className="block w-5 h-1 bg-[#F6A623] rounded-full"/>
    <span className="block w-3.5 h-1 bg-[#F6A623] rounded-full ml-1"/>
  </span>
);

/* ─── Hero Section ───────────────────────────────────────────── */
const HeroSection: React.FC = () => (
  <section className="relative bg-white overflow-hidden">
    {/* Soft orange glow */}
    <div
      className="absolute -top-16 -left-16 w-72 h-72 rounded-full pointer-events-none"
      style={{ background: 'radial-gradient(circle, rgba(246,166,35,0.35) 0%, transparent 70%)' }}
    />
    <div
      className="absolute -bottom-10 left-1/3 w-56 h-56 rounded-full pointer-events-none"
      style={{ background: 'radial-gradient(circle, rgba(246,166,35,0.25) 0%, transparent 70%)' }}
    />

    <div className="relative max-w-6xl mx-auto px-5 md:px-10">
      <div className="flex flex-col md:flex-row items-center min-h-[340px] md:min-h-[400px]">

        {/* ── Left column: text ── */}
        <div className="flex-1 py-10 md:py-14 z-10 order-2 md:order-1 text-center md:text-left">
          <h1 className="flex items-center justify-center md:justify-start">
            <img src="/morfi-logo-nuevo.jpeg" alt="MORFI" className="h-16 w-[225px] object-contain object-left md:h-20 md:w-[285px]" />
            <TitleTicks />
          </h1>

          {/* Subtitle */}
          <h2 className="text-xl md:text-2xl font-bold text-[#8B3F14] leading-snug mt-3 mb-3 max-w-sm mx-auto md:mx-0">
            Todo lo que necesitás para<br className="hidden md:block"/> comer, vender y ahorrar
          </h2>

          {/* Description */}
          <p className="text-sm md:text-[15px] text-gray-500 leading-relaxed mb-7 max-w-xs mx-auto md:mx-0">
            Comida casera, gestión de tu emprendimiento gastronómico y comparación de precios en un solo lugar.
          </p>

          {/* CTA button */}
          <Link
            to="/hungry"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-[#F6A623] text-[#8B3F14] font-bold text-base hover:brightness-95 transition-all shadow-md no-underline"
          >
            Comenzar ahora
            <ArrowRight className="w-5 h-5"/>
          </Link>
        </div>

        {/* ── Right column: delivery image ── */}
        <div className="flex-1 relative flex justify-center md:justify-end order-1 md:order-2 pt-6 md:pt-0">
          <TickDecoration/>
          {/* Featured food image */}
          <div className="relative w-full max-w-[320px] md:max-w-[460px] h-[240px] md:h-[400px] overflow-hidden rounded-2xl md:rounded-none md:overflow-visible">
            <img
              src="/morfi-portada.jpeg"
              alt="Mesa con platos frescos para compartir"
              className="w-full h-full object-cover rounded-2xl md:rounded-xl shadow-lg"
            />
            {/* Brand mark */}
            <div className="absolute bottom-4 right-4 bg-white/95 rounded-xl px-3 py-2 shadow-md">
              <img src="/morfi-icon.svg" alt="" className="h-10 w-10" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Section card data ──────────────────────────────────────── */
interface CardData {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  imgSrc: string;
  imgAlt: string;
  imgFit?: 'cover' | 'contain';
  cta: string;
}

const CARDS: CardData[] = [
  {
    to: '/hungry',
    icon: <IconCloche className="w-10 h-10 text-[#8B3F14]"/>,
    title: 'Tengo hambre',
    description: 'Explorá negocios gastronómicos, conocé sus menús y hacé tu pedido de forma rápida y simple.',
    imgSrc: '/morfi-hambre.jpeg',
    imgAlt: 'Comidas disponibles en Tengo hambre',
    cta: 'Explorar menús',
  },
  {
    to: '/business',
    icon: <IconStore className="w-10 h-10 text-[#8B3F14]"/>,
    title: 'Mi emprendimiento',
    description: 'Administrá tu negocio gastronómico: costos, recetas, inventario, ventas y pedidos.',
    imgSrc: '/morfi-emprendimiento.png',
    imgAlt: 'Administración de un emprendimiento gastronómico',
    imgFit: 'contain',
    cta: 'Gestionar mi negocio',
  },
  {
    to: '/savings',
    icon: <IconCart className="w-10 h-10 text-[#8B3F14]"/>,
    title: 'MORFI Ahorro',
    description: 'Compará precios de productos y canastas de compra entre diferentes comercios y ahorrá en tus insumos.',
    imgSrc: '/morfi-ahorro%20(2).png',
    imgAlt: 'Comparación de precios entre supermercados y proveedores',
    imgFit: 'contain',
    cta: 'Comparar precios',
  },
];

/* ─── Desktop: 3-column cards grid ─────────────────────────────*/
const DesktopCards: React.FC = () => (
  <section className="hidden md:block bg-white pt-2 pb-14">
    <div className="max-w-6xl mx-auto px-10">
      <div className="grid grid-cols-3 gap-5">
        {CARDS.map((card) => (
          <article
            key={card.to}
            className="bg-[#FFF3E5] rounded-2xl overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow"
          >
            {/* Icon + Title + Description */}
            <div className="p-5 pb-3">
              <div className="mb-3">{card.icon}</div>
              <h3 className="text-lg font-bold text-[#8B3F14] mb-2">{card.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{card.description}</p>
            </div>

            {/* Image */}
            <div className="flex-1 mx-4 mb-4 rounded-xl overflow-hidden bg-[#FFF3E5]" style={{ minHeight: '160px', maxHeight: '180px' }}>
              <img
                src={card.imgSrc}
                alt={card.imgAlt}
                className={`w-full h-full ${card.imgFit === 'contain' ? 'object-contain' : 'object-cover'}`}
                style={{ minHeight: '160px' }}
              />
            </div>

            {/* CTA */}
            <div className="px-4 pb-5">
              <Link
                to={card.to}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-[#8B3F14] text-white font-semibold text-sm hover:bg-[#B84E0E] transition-colors no-underline"
              >
                {card.cta}
                <ArrowRight className="w-4 h-4"/>
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Mobile: stacked row cards ─────────────────────────────── */
const MobileCards: React.FC = () => (
  <section className="md:hidden bg-white pt-1 pb-4 flex flex-col gap-3 px-4">
    {CARDS.map((card) => (
      <article
        key={card.to}
        className="bg-[#FFF3E5] rounded-2xl overflow-hidden shadow-sm"
      >
        <div className="flex items-stretch">
          {/* Left: icon + text */}
          <div className="flex-1 p-4 pr-2">
            <div className="mb-2">{card.icon}</div>
            <h3 className="text-base font-bold text-[#8B3F14] mb-1">{card.title}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">{card.description}</p>
          </div>

          {/* Right: image + arrow stacked */}
          <div className="flex flex-col items-end justify-between p-3 pl-0 gap-2">
            <div className="w-28 h-24 rounded-xl overflow-hidden flex-shrink-0 bg-[#FFF3E5]">
              <img
                src={card.imgSrc}
                alt={card.imgAlt}
                className={`w-full h-full ${card.imgFit === 'contain' ? 'object-contain' : 'object-cover'}`}
              />
            </div>
            <Link
              to={card.to}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-[#8B3F14] text-white hover:bg-[#B84E0E] transition-colors no-underline flex-shrink-0"
              aria-label={card.cta}
            >
              <ArrowRight className="w-4 h-4"/>
            </Link>
          </div>
        </div>
      </article>
    ))}
  </section>
);

/* ─── Page ───────────────────────────────────────────────────── */
const Home: React.FC = () => (
  <div className="bg-white min-h-screen">
    <HeroSection />
    <DesktopCards />
    <MobileCards />
  </div>
);

export default Home;
