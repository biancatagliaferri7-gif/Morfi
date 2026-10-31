import React from 'react';
import { Link } from 'react-router-dom';
import './Home.css';

/* ─── Icon helpers (reused from App but self-contained) ─────── */
const ArrowRight = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="12 5 19 12 12 19"/>
  </svg>
);

const IconCloche = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 14h20"/>
    <path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/>
    <path d="M6 14v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1"/>
  </svg>
);

const IconStore = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l1-4h16l1 4"/>
    <path d="M3 9a2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2"/>
    <path d="M5 21V11m14 10V11"/>
    <rect x="9" y="15" width="6" height="6" rx="1"/>
  </svg>
);

const IconCart = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
);

/* ─── Tick decoration (reference has these in top-right of hero) */
const TickDecoration = () => (
  <div className="home-ticks" aria-hidden="true">
    <span />
    <span />
    <span />
  </div>
);

/* ─── Orange accent ticks next to MORFI logo ────────────────── */
const TitleTicks = () => (
  <span className="home-title-ticks" aria-hidden="true">
    <span />
    <span />
  </span>
);

/* ─── Hero Section ───────────────────────────────────────────── */
const HeroSection: React.FC = () => (
  <section className="home-hero">
    <div className="home-hero-glow home-hero-glow-left" aria-hidden="true" />
    <div className="home-hero-glow home-hero-glow-right" aria-hidden="true" />
    <div className="home-container home-hero-layout">
      <div className="home-hero-copy">
        <p className="home-eyebrow">
          Todo lo rico, cerca
        </p>
        <h1 className="home-brand">
          <img src="/morfi-logo-nuevo.jpeg" alt="MORFI" />
          <TitleTicks />
        </h1>
        <h2 className="home-headline">
          Comé rico. Vendé mejor. <span>Ahorrá.</span>
        </h2>
        <p className="home-intro">
          Encontrá comida casera, hacé crecer tu emprendimiento y cuidá tu bolsillo, todo en un mismo lugar.
        </p>
        <div className="home-hero-actions">
          <Link
            to="/hungry"
            className="home-primary-button"
          >
            Tengo hambre
            <ArrowRight className="home-button-arrow" />
          </Link>
          <span className="home-action-note">Elegí por dónde empezar</span>
        </div>
        <div className="home-highlights">
          <span>Comida de tu zona</span>
          <span>Herramientas para vender</span>
          <span>Precios para comparar</span>
        </div>
      </div>

      <div className="home-hero-visual">
        <TickDecoration />
        <div className="home-cover">
          <img
            src="/morfi-portada.jpeg"
            alt="Mesa con platos frescos para compartir"
            className="home-cover-image"
          />
          <div className="home-cover-shade" />
          <div className="home-cover-caption">
            <div>
              <p>Un mismo lugar</p>
              <strong>Para comer, vender y ahorrar</strong>
            </div>
            <img src="/morfi-icon.svg" alt="" />
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Section card data ──────────────────────────────────────── */
interface CardData {
  to: string;
  icon: React.ReactElement<{ className: string }>;
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
    description: 'Descubrí comida casera cerca tuyo y encontrá algo rico para hoy.',
    imgSrc: '/morfi-hambre.jpeg',
    imgAlt: 'Comidas disponibles en Tengo hambre',
    cta: 'Explorar menús',
  },
  {
    to: '/business',
    icon: <IconStore className="w-10 h-10 text-[#8B3F14]"/>,
    title: 'Mi emprendimiento',
    description: 'Organizá tus productos, costos y tareas para llevar tu negocio adelante.',
    imgSrc: '/morfi-emprendimiento.png',
    imgAlt: 'Administración de un emprendimiento gastronómico',
    imgFit: 'contain',
    cta: 'Gestionar mi negocio',
  },
  {
    to: '/savings',
    icon: <IconCart className="w-10 h-10 text-[#8B3F14]"/>,
    title: 'MORFI Ahorro',
    description: 'Compará precios y encontrá opciones para cuidar la plata en tus compras.',
    imgSrc: '/morfi-ahorro%20(2).png',
    imgAlt: 'Comparación de precios entre supermercados y proveedores',
    imgFit: 'contain',
    cta: 'Comparar precios',
  },
];

const AccessCards: React.FC = () => (
  <section className="home-access">
    <div className="home-container">
      <div className="home-section-heading">
        <p>Tres formas de usar MORFI</p>
        <h2>¿Qué necesitás hoy?</h2>
      </div>
      <div className="home-card-grid">
        {CARDS.map(card => (
          <article
            key={card.to}
            className="home-card"
          >
            <div className={`home-card-image-wrap${card.imgFit === 'contain' ? ' home-card-image-wrap-contained' : ''}`}>
              <img
                src={card.imgSrc}
                alt={card.imgAlt}
                className={`home-card-image${card.imgFit === 'contain' ? ' home-card-image-contained' : ''}`}
                loading="lazy"
              />
              <div className="home-card-icon">
                {React.cloneElement(card.icon, { className: 'home-card-icon-svg' })}
              </div>
            </div>
            <div className="home-card-content">
              <h3>{card.title}</h3>
              <p>{card.description}</p>
              <Link
                to={card.to}
                className="home-card-button"
              >
                {card.cta}
                <ArrowRight className="home-button-arrow" />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Page ───────────────────────────────────────────────────── */
const Home: React.FC = () => (
  <div className="home-page">
    <HeroSection />
    <AccessCards />
  </div>
);

export default Home;
