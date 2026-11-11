import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { BankFields } from './SellerFields';
import { isOrderCheckoutV2Enabled } from '../orders/orderService';

type Settings = {
  is_open: boolean;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  delivery_fee: number;
  delivery_fee_status: 'pending' | 'free' | 'fixed';
  payment_method: ('cash' | 'transfer')[];
  contact_phone: string;
  phone_is_public: boolean;
  bank_name: string;
  bank_cuit: string;
  transfer_alias: string;
  transfer_holder: string;
};

const fieldClass = 'mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal';

export default function BusinessSettings({ businessId }: { businessId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setSettings(null);
    setError('');
    setNotice('');
    if (!supabase) return;
    void supabase.rpc('morfi_managed_business_settings', { p_business_id: businessId }).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError || !data?.[0]) {
        setError('No se pudo cargar cómo vendés. Revisá la conexión y volvé a abrir el panel.');
        return;
      }
      const row = data[0];
      setSettings({ ...row, delivery_fee: Number(row.delivery_fee), delivery_fee_status: isOrderCheckoutV2Enabled ? row.delivery_fee_status : Number(row.delivery_fee) > 0 ? 'fixed' : 'free', contact_phone: row.contact_phone ?? '', bank_name: row.bank_name ?? '', bank_cuit: row.bank_cuit ?? '', transfer_alias: row.transfer_alias ?? '', transfer_holder: row.transfer_holder ?? '' });
    });
    return () => { active = false; };
  }, [businessId]);

  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(current => current ? { ...current, [key]: value } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !supabase || busy) return;
    setError(''); setNotice('');
    if ((!settings.accepts_delivery && !settings.accepts_pickup) || !settings.payment_method.length) {
      setError('Elegí retiro o entrega y al menos un medio de pago.'); return;
    }
    if (!Number.isFinite(settings.delivery_fee) || settings.delivery_fee < 0 || (settings.delivery_fee_status === 'fixed' && settings.delivery_fee <= 0)) {
      setError('Ingresá un costo de entrega mayor que cero o elegí entrega gratis.'); return;
    }
    if (settings.payment_method.includes('transfer') && (!settings.bank_name.trim() || !settings.transfer_alias.trim() || !settings.transfer_holder.trim() || !/^\d{11}$/.test(settings.bank_cuit.replace(/\D/g, '')))) {
      setError('Para cobrar por transferencia completá banco, alias, titular y CUIT de 11 números.'); return;
    }
    setBusy(true);
    const { delivery_fee_status, payment_method, ...fields } = settings;
    const { data, error: saveError } = await supabase.from('morfi_businesses').update({
      ...fields,
      payment_methods: [...new Set(['cash',...payment_method])],
      contact_phone: settings.contact_phone.trim() || null,
      phone_is_public: settings.phone_is_public && Boolean(settings.contact_phone.trim()),
      bank_name: settings.bank_name.trim() || null,
      bank_cuit: settings.bank_cuit.replace(/\D/g, '') || null,
      transfer_alias: settings.transfer_alias.trim() || null,
      transfer_holder: settings.transfer_holder.trim() || null,
      delivery_fee: delivery_fee_status === 'fixed' ? settings.delivery_fee : 0,
      ...(isOrderCheckoutV2Enabled ? { delivery_fee_status } : {}),
    }).eq('id', businessId).select('id').single();
    setBusy(false);
    if (saveError || !data) { setError('No se pudo guardar cómo vendés. Revisá tu conexión y volvé a intentar.'); return; }
    window.dispatchEvent(new Event('morfi-business-changed'));
    setNotice('Guardado. Los clientes verán estas opciones al pedir.');
  }

  return <section className="mt-5 rounded-xl border border-[#F2DDCA] bg-[#FFF9F2] p-4">
    <h3 className="font-bold">Cómo vendés hoy</h3>
    {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-800">{error}</p>}
    {!settings && !error && <p role="status" className="mt-2 text-sm">Cargando opciones…</p>}
    {settings && <form onSubmit={event => void save(event)} className="mt-3 space-y-3">

      <div className="flex flex-wrap gap-4">{(['accepts_pickup', 'accepts_delivery'] as const).map(key => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={settings[key]} onChange={event => change(key, event.target.checked)} />{key === 'accepts_pickup' ? 'Retiro en el local' : 'Entrega a domicilio'}</label>)}</div>
      {settings.accepts_delivery && <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Costo de entrega<select value={settings.delivery_fee_status} onChange={event => change('delivery_fee_status', event.target.value as Settings['delivery_fee_status'])} className={fieldClass}>{isOrderCheckoutV2Enabled && <option value="pending">Confirmar con cada pedido</option>}<option value="free">Gratis</option><option value="fixed">Tarifa fija</option></select></label>
        {settings.delivery_fee_status === 'fixed' && <label className="text-sm font-semibold">Importe en pesos<input type="number" min="0.01" step="0.01" value={settings.delivery_fee} onChange={event => change('delivery_fee', Number(event.target.value))} className={fieldClass} required /></label>}
      </div>}
      <label className="block font-semibold">¿Aceptás pago con transferencia?<select className={fieldClass} value={String(settings.payment_method.includes('transfer'))} onChange={e=>change('payment_method',e.target.value==='true'?['cash','transfer']:['cash'])}><option value="false">No</option><option value="true">Sí</option></select></label>
      <p className="text-sm">El efectivo siempre está disponible.</p>
      <label className="block text-sm font-semibold">Teléfono de consultas<input type="tel" maxLength={40} value={settings.contact_phone} onChange={event => change('contact_phone', event.target.value)} className={fieldClass} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.phone_is_public} onChange={event => change('phone_is_public', event.target.checked)} />Mostrar mi teléfono en el catálogo</label>
      {settings.payment_method.includes('transfer') && <BankFields data={settings} onChange={patch=>setSettings(s=>s?{...s,...patch}:s)}/>}
      {notice && <p role="status" className="text-sm font-semibold text-green-800">{notice}</p>}
      <button disabled={busy} className="rounded-xl bg-[#8B3F14] px-5 py-3 font-bold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar cómo vendés'}</button>
    </form>}
  </section>;
}
