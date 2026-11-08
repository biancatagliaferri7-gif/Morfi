import { publicSupabase } from '../lib/supabaseClient';

export type PublicBusiness = {
  id: string;
  name: string;
  description: string;
  logo_path: string | null;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  delivery_fee: number;
  payment_methods: ('cash' | 'transfer')[];
  is_open: boolean;
};

export type PublicBusinessProduct = {
  id: string;
  business_id: string;
  name: string;
  description: string;
  image_path: string | null;
  price: number;
  is_available: boolean;
  accepts_delivery: boolean;
  payment_methods: ('cash' | 'transfer')[];
  cash_discount_percent: number | null;
};

export type PublicBusinessContact = {
  contact_phone: string | null;
  contact_email: string | null;
  transfer_alias: string | null;
  transfer_holder: string | null;
  location: string | null;
  directions: string | null;
};

export type PublicBusinessCatalog = {
  business: PublicBusiness;
  products: PublicBusinessProduct[];
  contact: PublicBusinessContact | null;
};

type PublicBusinessCatalogRow = {
  business_id: string;
  business_name: string;
  business_description: string;
  logo_path: string | null;
  business_accepts_delivery: boolean;
  accepts_pickup: boolean;
  delivery_fee: number;
  business_payment_methods: ('cash' | 'transfer')[];
  is_open: boolean;
  product_id: string;
  product_name: string;
  product_description: string;
  image_path: string | null;
  price: number;
  is_available: boolean;
  accepts_delivery: boolean;
  payment_methods: ('cash' | 'transfer')[];
  cash_discount_percent: number | null;
};

function getSupabase() {
  if (!publicSupabase) {
    throw new Error('Supabase no está configurado. Revisá las variables públicas de conexión.');
  }
  return publicSupabase;
}

export async function listPublishedBusinessCatalog(): Promise<PublicBusinessCatalog[]> {
  const client = getSupabase();
  const { data, error } = await client
    .from('morfi_public_business_catalog')
    .select('business_id, business_name, business_description, logo_path, business_accepts_delivery, accepts_pickup, delivery_fee, business_payment_methods, is_open, product_id, product_name, product_description, image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent')
    .order('business_name') as { data: PublicBusinessCatalogRow[] | null; error: Error | null };

  if (error) throw error;
  if (!data?.length) return [];

  const businessIds = [...new Set(data.map(row => row.business_id))];

  const contacts = await Promise.all(businessIds.map(async businessId => {
    const { data, error } = await client.rpc('morfi_public_business_contact', {
      p_business_id: businessId,
    });
    if (error) throw error;
    return [businessId, data?.[0] ?? null] as const;
  }));
  const contactsByBusinessId = new Map(contacts);
  const byBusiness = new Map<string, PublicBusinessCatalog>();
  for (const row of data) {
    const entry: PublicBusinessCatalog = byBusiness.get(row.business_id) ?? {
      business: {
        id: row.business_id,
        name: row.business_name,
        description: row.business_description,
        logo_path: row.logo_path,
        accepts_delivery: row.business_accepts_delivery,
        accepts_pickup: row.accepts_pickup,
        delivery_fee: row.delivery_fee,
        payment_methods: row.business_payment_methods,
        is_open: row.is_open,
      },
      products: [],
      contact: contactsByBusinessId.get(row.business_id) ?? null,
    };
    entry.products.push({
      id: row.product_id,
      business_id: row.business_id,
      name: row.product_name,
      description: row.product_description,
      image_path: row.image_path,
      price: row.price,
      is_available: row.is_available,
      accepts_delivery: row.accepts_delivery,
      payment_methods: row.payment_methods,
      cash_discount_percent: row.cash_discount_percent,
    });
    byBusiness.set(row.business_id, entry);
  }
  return [...byBusiness.values()];
}
