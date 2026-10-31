import { supabase } from '../lib/supabaseClient';

export type ManagedBusiness = {
  id: string;
  name: string;
  description: string;
  is_published: boolean;
};

export type BusinessProduct = {
  id: string;
  business_id: string;
  name: string;
  description: string;
  image_path: string | null;
  price: number;
  stock_quantity: number;
  is_available: boolean;
  accepts_delivery: boolean;
  payment_methods: ('cash' | 'transfer')[];
  cash_discount_percent: number | null;
};

export type BusinessProductInput = Pick<
  BusinessProduct,
  'name' | 'description' | 'image_path' | 'price' | 'is_available' |
  'accepts_delivery' | 'payment_methods' | 'cash_discount_percent'
>;

function getSupabase() {
  if (!supabase) {
    throw new Error('Supabase no está configurado. Revisá las variables públicas de conexión.');
  }
  return supabase;
}

export async function listManagedBusinesses(userId: string): Promise<ManagedBusiness[]> {
  const client = getSupabase();
  const { data: memberships, error: membershipsError } = await client
    .from('morfi_business_memberships')
    .select('business_id')
    .eq('user_id', userId)
    .in('role', ['owner', 'manager']);

  if (membershipsError) throw membershipsError;

  const businessIds = memberships.map(membership => membership.business_id);
  if (businessIds.length === 0) return [];

  const { data, error } = await client
    .from('morfi_businesses')
    .select('id, name, description, is_published')
    .in('id', businessIds);

  if (error) throw error;
  return data ?? [];
}

export async function createBusiness(
  userId: string,
  name: string,
  description: string,
): Promise<ManagedBusiness> {
  const client = getSupabase();
  const { data, error } = await client
    .from('morfi_businesses')
    .insert({ created_by: userId, name, description })
    .select('id, name, description, is_published')
    .single();

  if (error) throw error;
  return data;
}

export async function updateBusinessPublication(
  businessId: string,
  isPublished: boolean,
): Promise<ManagedBusiness> {
  const { data, error } = await getSupabase()
    .from('morfi_businesses')
    .update({ is_published: isPublished })
    .eq('id', businessId)
    .select('id, name, description, is_published')
    .single();

  if (error) throw error;
  return data;
}

const businessProductColumns =
  'id, business_id, name, description, image_path, price, stock_quantity, is_available, accepts_delivery, payment_methods, cash_discount_percent';

export async function listBusinessProducts(businessId: string): Promise<BusinessProduct[]> {
  const { data, error } = await getSupabase()
    .from('morfi_business_products')
    .select(businessProductColumns)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createBusinessProduct(
  businessId: string,
  product: BusinessProductInput,
): Promise<BusinessProduct> {
  const { data, error } = await getSupabase()
    .from('morfi_business_products')
    .insert({ business_id: businessId, ...product })
    .select(businessProductColumns)
    .single();

  if (error) throw error;
  return data;
}

export async function updateBusinessProduct(
  businessId: string,
  productId: string,
  updates: Partial<BusinessProductInput>,
): Promise<BusinessProduct> {
  const { data, error } = await getSupabase()
    .from('morfi_business_products')
    .update(updates)
    .eq('business_id', businessId)
    .eq('id', productId)
    .select(businessProductColumns)
    .single();

  if (error) throw error;
  return data;
}

export async function deleteBusinessProduct(businessId: string, productId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('morfi_business_products')
    .delete()
    .eq('business_id', businessId)
    .eq('id', productId);

  if (error) throw error;
}
