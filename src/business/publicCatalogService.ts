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

function getSupabase() {
  if (!publicSupabase) {
    throw new Error('Supabase no está configurado. Revisá las variables públicas de conexión.');
  }
  return publicSupabase;
}

export async function listPublishedBusinessCatalog(): Promise<PublicBusinessCatalog[]> {
  const client = getSupabase();
  const { data: businesses, error: businessesError } = await client
    .from('morfi_businesses')
    .select('id, name, description, logo_path, accepts_delivery, accepts_pickup, delivery_fee, payment_methods, is_open')
    .eq('is_published', true)
    .order('name');

  if (businessesError) throw businessesError;
  if (!businesses.length) return [];

  const businessIds = businesses.map(business => business.id);
  const { data: products, error: productsError } = await client
    .from('morfi_business_products')
    .select('id, business_id, name, description, image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent')
    .in('business_id', businessIds)
    .eq('is_available', true);

  if (productsError) throw productsError;

  const contacts = await Promise.all(businessIds.map(async businessId => {
    const { data, error } = await client.rpc('morfi_public_business_contact', {
      p_business_id: businessId,
    });
    if (error) throw error;
    return [businessId, data?.[0] ?? null] as const;
  }));
  const contactsByBusinessId = new Map(contacts);
  const productsByBusinessId = new Map<string, PublicBusinessProduct[]>();

  for (const product of products) {
    const productList = productsByBusinessId.get(product.business_id) ?? [];
    productList.push(product);
    productsByBusinessId.set(product.business_id, productList);
  }

  return businesses.map(business => ({
    business,
    products: productsByBusinessId.get(business.id) ?? [],
    contact: contactsByBusinessId.get(business.id) ?? null,
  }));
}
