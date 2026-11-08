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
          <img src="/MORFI_logo_naranja_transparente.png" alt="MORFI" />
          <TitleTicks />
        </h1>
        <h2 className="home-headline">
          Comé rico.<br />
          Vendé mejor.<br />
          Ahorrá más.
        </h2>
        <p className="home-intro">
          Encontrá comida casera y ayudá a crecer a los emprendimientos de tu comunidad.
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
          <span>Comercio local</span>
        </div>
      </div>

      <div className="home-hero-visual">
        <TickDecoration />
        <div className="home-cover">
          <img
            src="/portada.jpeg"
            alt="Mesa con platos frescos para compartir"
            className="home-cover-image"
          />
          <div className="home-cover-shade" />
          <div className="home-cover-caption">
            <div>
              <p>Un mismo lugar</p>
              <strong>Para comer y vender</strong>
            </div>
            <img src="/MORFI_logo_naranja_transparente.png" alt="" />
          </div>
        </div>
      </div>
    </div>
  </section>
);

const VendorRegistration: React.FC = () => (
  <section className="home-access">
    <div className="home-container home-vendor-card-wrap">
      <article className="home-vendor-card">
        <div>
          <p className="home-vendor-eyebrow">Una oportunidad para crecer</p>
          <h2>VENDER EN MORFI</h2>
          <p>Registrá tu emprendimiento y vendé GRATIS. Organizá tus productos, costos y tareas para llevar tu negocio adelante.</p>
        </div>
        <Link to="/register?profile=emprendimiento" className="home-card-button">
          REGISTRARME
          <ArrowRight className="home-button-arrow" />
        </Link>
      </article>
    </div>
  </section>
);

const InstitutionalFooter: React.FC = () => (
  <footer className="home-institutional">
    <div className="home-container home-institutional-layout">
      <img
        src="/img.internetparatodos - Editado.png"
        alt="Internet para Todos"
        className="home-institutional-logo"
        loading="lazy"
      />
      <div>
        <h2>Impulsamos el crecimiento de los emprendimientos riojanos</h2>
        <p>MORFI es un proyecto que actualmente se encuentra en evaluación por Internet para Todos.</p>
        <p>Nuestra misión es impulsar a los emprendimientos riojanos y fortalecer el comercio electrónico local, brindándoles un espacio digital donde puedan dar a conocer sus productos, llegar a nuevos clientes y aumentar sus oportunidades de venta, sin comisiones abusivas.</p>
        <p>Además de facilitar las ventas, MORFI busca ofrecer herramientas sencillas para calcular los costos de producción, conocer la rentabilidad real de cada producto, mejorar la administración y reducir errores que puedan afectar el negocio.</p>
        <p className="home-institutional-emphasis">Queremos que cada emprendedor, sin importar el tamaño de su negocio o su experiencia tecnológica, tenga la oportunidad de crecer, organizarse y desarrollar su emprendimiento.</p>
      </div>
    </div>
  </footer>
);

/* ─── Page ───────────────────────────────────────────────────── */
const Home: React.FC = () => (
  <div className="home-page">
    <HeroSection />
    <VendorRegistration />
    <InstitutionalFooter />
  </div>
);

export default Home;
