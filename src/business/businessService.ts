import { supabase } from '../lib/supabaseClient';

export type ManagedBusiness = {
  id: string;
  name: string;
  description: string;
  logo_path: string | null;
  location: string | null;
  directions: string | null;
  latitude: number | null;
  longitude: number | null;
  phone_is_public: boolean;
  is_published: boolean;
};

export type BusinessRegistrationInput = {
  name: string;
  description: string;
  contact_phone: string;
  phone_is_public: boolean;
  location: string;
  directions: string;
  latitude: number | null;
  longitude: number | null;
  bank_name: string | null;
  transfer_alias: string | null;
  transfer_holder: string | null;
  bank_cuit: string | null;
  payment_methods: ('cash' | 'transfer')[];
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
    .select('id, name, description, logo_path, location, directions, latitude, longitude, phone_is_public, is_published')
    .in('id', businessIds);

  if (error) throw error;
  return data ?? [];
}

export async function createBusiness(
  userId: string,
  business: BusinessRegistrationInput,
): Promise<ManagedBusiness> {
  const client = getSupabase();
  const { data, error } = await client
    .from('morfi_businesses')
    .insert({
      created_by: userId,
      name: business.name,
      description: business.description,
      contact_phone: business.contact_phone,
      phone_is_public: business.phone_is_public,
      location: business.location,
      directions: business.directions,
      latitude: business.latitude,
      longitude: business.longitude,
      bank_name: business.bank_name,
      transfer_alias: business.transfer_alias,
      transfer_holder: business.transfer_holder,
      bank_cuit: business.bank_cuit,
    })
    .select('id, name, description, logo_path, location, directions, latitude, longitude, phone_is_public, is_published')
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
    .select('id, name, description, logo_path, location, directions, latitude, longitude, phone_is_public, is_published')
    .single();

  if (error) throw error;
  return data;
}

export async function updateBusinessCoordinates(
  businessId: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from('morfi_businesses')
    .update({ latitude, longitude })
    .eq('id', businessId);

  if (error) throw error;
}

export async function updateBusinessLocation(
  businessId: string,
  location: string,
  directions: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('morfi_businesses')
    .update({ location, directions })
    .eq('id', businessId);

  if (error) throw error;
}

export async function updateBusinessPhoneVisibility(
  businessId: string,
  isPublic: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from('morfi_businesses')
    .update({ phone_is_public: isPublic })
    .eq('id', businessId);

  if (error) throw error;
}

export async function uploadBusinessLogo(businessId: string, file: File): Promise<string> {
  const client = getSupabase();
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const extension = extensions[file.type];
  if (!extension || file.size > 5 * 1024 * 1024) {
    throw new Error('El logo debe ser JPG, PNG o WebP y pesar hasta 5 MB.');
  }

  const path = `businesses/${businessId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage
    .from('morfi-catalog')
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { error: updateError } = await client
    .from('morfi_businesses')
    .update({ logo_path: path })
    .eq('id', businessId);
  if (updateError) {
    const { error: cleanupError } = await client.storage
      .from('morfi-catalog')
      .remove([path]);
    if (cleanupError) {
      throw new Error(`${updateError.message}. No se pudo limpiar la imagen subida: ${cleanupError.message}`);
    }
    throw updateError;
  }

  return path;
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
