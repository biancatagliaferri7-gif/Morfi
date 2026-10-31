import { publicSupabase, supabase } from '../lib/supabaseClient';

export type Supplier = {
  id: string;
  name: string;
  description: string;
  logo_path: string | null;
  zone: string;
  is_published: boolean;
  show_in_market: boolean;
  role?: 'owner' | 'manager' | 'staff';
};

export type SupplierOffer = {
  supplier_id: string;
  product_id: string;
  supplier_name: string;
  supplier_description: string;
  logo_path: string | null;
  zone: string;
  product_name: string;
  product_description: string;
  category: string;
  comparison_key: string;
  sale_unit: string;
  image_path: string | null;
  price: number;
  is_available: boolean;
  accepts_delivery: boolean;
  payment_methods: ('cash' | 'transfer')[];
  cash_discount_percent: number | null;
};

export type SupplierPromotion = {
  id: string;
  supplier_id: string;
  supplier_product_id: string | null;
  title: string;
  description: string;
  discount_type: 'percent' | 'fixed_price';
  discount_value: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

export type SupplierContact = {
  contact_phone: string | null;
  contact_email: string | null;
};

export type SupplierProductInput = {
  name: string;
  description: string;
  category: string;
  comparison_key: string;
  sale_unit: string;
  image_path: string | null;
  price: number;
  is_available: boolean;
  accepts_delivery: boolean;
  payment_methods: ('cash' | 'transfer')[];
  cash_discount_percent: number | null;
};

export type SupplierPromotionInput = Omit<SupplierPromotion, 'id' | 'supplier_id'>;

function getClient(client: typeof supabase | typeof publicSupabase) {
  if (!client) {
    throw new Error('Supabase no está configurado. Revisá las variables públicas de conexión.');
  }
  return client;
}

export function supplierImageUrl(path: string | null): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return getClient(publicSupabase).storage.from('morfi-catalog').getPublicUrl(path).data.publicUrl;
}

export async function listPublicSupplierOffers(): Promise<{
  offers: SupplierOffer[];
  promotions: SupplierPromotion[];
  contacts: Map<string, SupplierContact | null>;
}> {
  const client = getClient(publicSupabase);
  const { data: offers, error } = await client
    .from('morfi_public_supplier_catalog')
    .select('supplier_id, product_id, supplier_name, supplier_description, logo_path, zone, product_name, product_description, category, comparison_key, sale_unit, image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent')
    .order('product_name');

  if (error) throw error;
  if (!offers?.length) return { offers: [], promotions: [], contacts: new Map() };

  const supplierIds = [...new Set(offers.map(offer => offer.supplier_id))];
  const { data: promotions, error: promotionError } = await client
    .from('morfi_supplier_promotions')
    .select('id, supplier_id, supplier_product_id, title, description, discount_type, discount_value, starts_at, ends_at, is_active')
    .in('supplier_id', supplierIds)
    .eq('is_active', true)
    .lte('starts_at', new Date().toISOString())
    .gt('ends_at', new Date().toISOString());

  if (promotionError) throw promotionError;

  const contactEntries = await Promise.all(supplierIds.map(async supplierId => {
    const { data, error: contactError } = await client.rpc('morfi_public_supplier_contact', {
      p_supplier_id: supplierId,
    });
    if (contactError) throw contactError;
    return [supplierId, data?.[0] ?? null] as const;
  }));

  return {
    offers,
    promotions: promotions ?? [],
    contacts: new Map(contactEntries),
  };
}

export async function listPublicMarketOffers(): Promise<{
  offers: SupplierOffer[];
  promotions: SupplierPromotion[];
  contacts: Map<string, SupplierContact | null>;
}> {
  const client = getClient(publicSupabase);
  const { data: offers, error } = await client
    .from('morfi_public_market_catalog')
    .select('supplier_id, product_id, supplier_name, supplier_description, logo_path, zone, product_name, product_description, category, comparison_key, sale_unit, image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent')
    .order('product_name');

  if (error) throw error;
  if (!offers?.length) return { offers: [], promotions: [], contacts: new Map() };

  const supplierIds = [...new Set(offers.map(offer => offer.supplier_id))];
  const { data: promotions, error: promotionError } = await client
    .from('morfi_supplier_promotions')
    .select('id, supplier_id, supplier_product_id, title, description, discount_type, discount_value, starts_at, ends_at, is_active')
    .in('supplier_id', supplierIds)
    .eq('is_active', true)
    .lte('starts_at', new Date().toISOString())
    .gt('ends_at', new Date().toISOString());

  if (promotionError) throw promotionError;

  const contactEntries = await Promise.all(supplierIds.map(async supplierId => {
    const { data, error: contactError } = await client.rpc('morfi_public_supplier_contact', {
      p_supplier_id: supplierId,
    });
    if (contactError) throw contactError;
    return [supplierId, data?.[0] ?? null] as const;
  }));

  return {
    offers,
    promotions: promotions ?? [],
    contacts: new Map(contactEntries),
  };
}

export async function listManagedSuppliers(userId: string): Promise<Supplier[]> {
  const client = getClient(supabase);
  const { data: memberships, error: membershipError } = await client
    .from('morfi_supplier_memberships')
    .select('supplier_id, role')
    .eq('user_id', userId)
    .in('role', ['owner', 'manager', 'staff']);

  if (membershipError) throw membershipError;
  if (!memberships?.length) return [];

  const { data, error } = await client
    .from('morfi_suppliers')
    .select('id, name, description, logo_path, zone, is_published, show_in_market')
    .in('id', memberships.map(membership => membership.supplier_id))
    .order('name');

  if (error) throw error;
  const roleBySupplier = new Map(memberships.map(membership => [membership.supplier_id, membership.role]));
  return (data ?? []).map(supplier => ({
    ...supplier,
    role: roleBySupplier.get(supplier.id) ?? 'staff',
  }));
}

export async function listManagedSupplierOffers(supplierIds: string[]): Promise<SupplierOffer[]> {
  if (!supplierIds.length) return [];
  const { data, error } = await getClient(supabase)
    .from('morfi_supplier_products')
    .select('id, supplier_id, name, description, category, comparison_key, sale_unit, image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent')
    .in('supplier_id', supplierIds)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const suppliers = await getClient(supabase)
    .from('morfi_suppliers')
    .select('id, name, description, logo_path, zone')
    .in('id', supplierIds);

  if (suppliers.error) throw suppliers.error;
  const supplierById = new Map((suppliers.data ?? []).map(supplier => [supplier.id, supplier]));
  return (data ?? []).flatMap(product => {
    const supplier = supplierById.get(product.supplier_id);
    if (!supplier) return [];
    return [{
      supplier_id: product.supplier_id,
      product_id: product.id,
      supplier_name: supplier.name,
      supplier_description: supplier.description,
      logo_path: supplier.logo_path,
      zone: supplier.zone,
      product_name: product.name,
      product_description: product.description,
      category: product.category,
      comparison_key: product.comparison_key,
      sale_unit: product.sale_unit,
      image_path: product.image_path,
      price: Number(product.price),
      is_available: product.is_available,
      accepts_delivery: product.accepts_delivery,
      payment_methods: product.payment_methods as ('cash' | 'transfer')[],
      cash_discount_percent: product.cash_discount_percent,
    }];
  });
}

export async function createSupplier(
  userId: string,
  input: {
    name: string;
    description: string;
    logoPath: string | null;
    contactPhone: string;
    phoneIsPublic: boolean;
  },
): Promise<Supplier> {
  const { data, error } = await getClient(supabase)
    .from('morfi_suppliers')
    .insert({
      created_by: userId,
      name: input.name,
      description: input.description,
      logo_path: input.logoPath,
      contact_phone: input.contactPhone,
      phone_is_public: input.phoneIsPublic,
      is_published: true,
    })
    .select('id, name, description, logo_path, zone, is_published, show_in_market')
    .single();

  if (error) throw error;
  return data;
}

export async function createSupplierProduct(
  supplierId: string,
  product: SupplierProductInput,
) {
  const { data, error } = await getClient(supabase)
    .from('morfi_supplier_products')
    .insert({ supplier_id: supplierId, ...product })
    .select('id, supplier_id, name, description, category, comparison_key, sale_unit, image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent')
    .single();

  if (error) throw error;
  return data;
}

export async function updateSupplierProduct(
  supplierId: string,
  productId: string,
  product: SupplierProductInput,
) {
  const { data, error } = await getClient(supabase)
    .from('morfi_supplier_products')
    .update(product)
    .eq('supplier_id', supplierId)
    .eq('id', productId)
    .select('id, supplier_id, name, description, category, comparison_key, sale_unit, image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSupplierProduct(supplierId: string, productId: string): Promise<void> {
  const { error } = await getClient(supabase)
    .from('morfi_supplier_products')
    .delete()
    .eq('supplier_id', supplierId)
    .eq('id', productId);

  if (error) throw error;
}

export async function updateSupplierPublication(supplierId: string, isPublished: boolean): Promise<Supplier> {
  const { data, error } = await getClient(supabase)
    .from('morfi_suppliers')
    .update({ is_published: isPublished })
    .eq('id', supplierId)
    .select('id, name, description, logo_path, zone, is_published, show_in_market')
    .single();

  if (error) throw error;
  return data;
}

export async function updateSupplierMarketVisibility(supplierId: string, showInMarket: boolean): Promise<Supplier> {
  const { data, error } = await getClient(supabase)
    .from('morfi_suppliers')
    .update({ show_in_market: showInMarket })
    .eq('id', supplierId)
    .select('id, name, description, logo_path, zone, is_published, show_in_market')
    .single();

  if (error) throw error;
  return data;
}

export async function updateSupplierLogo(supplierId: string, logoPath: string): Promise<Supplier> {
  const { data, error } = await getClient(supabase)
    .from('morfi_suppliers')
    .update({ logo_path: logoPath })
    .eq('id', supplierId)
    .select('id, name, description, logo_path, zone, is_published, show_in_market')
    .single();

  if (error) throw error;
  return data;
}

export async function uploadSupplierImage(supplierId: string, file: File, kind: 'logo' | 'products') {
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `suppliers/${supplierId}/${kind}/${crypto.randomUUID()}.${extension}`;
  const { error } = await getClient(supabase).storage
    .from('morfi-catalog')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) throw error;
  return getClient(supabase).storage.from('morfi-catalog').getPublicUrl(path).data.publicUrl;
}

export async function createSupplierPromotion(supplierId: string, input: SupplierPromotionInput) {
  const { data, error } = await getClient(supabase)
    .from('morfi_supplier_promotions')
    .insert({ supplier_id: supplierId, ...input })
    .select('id, supplier_id, supplier_product_id, title, description, discount_type, discount_value, starts_at, ends_at, is_active')
    .single();

  if (error) throw error;
  return data;
}

export async function listManagedSupplierPromotions(supplierIds: string[]): Promise<SupplierPromotion[]> {
  if (!supplierIds.length) return [];
  const { data, error } = await getClient(supabase)
    .from('morfi_supplier_promotions')
    .select('id, supplier_id, supplier_product_id, title, description, discount_type, discount_value, starts_at, ends_at, is_active')
    .in('supplier_id', supplierIds)
    .order('starts_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function deleteSupplierPromotion(supplierId: string, promotionId: string): Promise<void> {
  const { error } = await getClient(supabase)
    .from('morfi_supplier_promotions')
    .delete()
    .eq('supplier_id', supplierId)
    .eq('id', promotionId);

  if (error) throw error;
}
