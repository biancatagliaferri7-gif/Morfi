import React from 'react';
import { Link } from 'react-router-dom';

const Savings: React.FC = () => (
  <div className="bg-white min-h-screen">
    <div className="max-w-4xl mx-auto px-5 md:px-10 py-10">
      <Link to="/" className="inline-flex items-center gap-2 text-[#173D2B] font-semibold mb-6 no-underline hover:text-[#1E5C3E]">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
        </svg>
        Volver
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <svg className="w-10 h-10 text-[#173D2B]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path strokeLinecap="round" d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
        <h1 className="text-3xl font-black text-[#173D2B]">MORFI Ahorro</h1>
      </div>
      <div className="bg-[#F0F7EE] rounded-2xl p-6">
        <img
          src="https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80"
          alt="Canasta de verduras"
          className="w-full h-56 object-cover rounded-xl mb-4"
        />
        <p className="text-gray-600 leading-relaxed">
          Compará precios de productos y canastas de compra entre diferentes comercios y ahorrá en tus insumos.
          <br /><br />
          <span className="text-[#173D2B] font-semibold">[Demo] Esta sección mostrará el comparador de precios.</span>
        </p>
      </div>
    </div>
  </div>
);

export default Savings;
