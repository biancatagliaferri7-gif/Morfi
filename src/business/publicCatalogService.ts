import { publicSupabase } from '../lib/supabaseClient';
import { isOrderCheckoutV2Enabled } from '../orders/orderService';

export type PublicBusiness = {
  id: string;
  name: string;
  description: string;
  logo_path: string | null;
  latitude: number | null;
  longitude: number | null;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  delivery_fee: number | null;
  delivery_fee_status: 'pending' | 'free' | 'fixed' | null;
  is_open: boolean;
  average_rating: number | null;
  review_count: number;
};

type PublicBusinessRow = Omit<PublicBusiness, 'average_rating' | 'review_count'>;

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
  average_rating: number | null;
  review_count: number;
};

export type PublicBusinessContact = {
  contact_phone: string | null;
  contact_email: string | null;
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
  let businesses: PublicBusinessRow[];
  if (isOrderCheckoutV2Enabled) {
    const result = await client
      .from('morfi_businesses')
      .select('id, name, description, logo_path, latitude, longitude, accepts_delivery, accepts_pickup, delivery_fee, is_open, delivery_fee_status')
      .eq('is_published', true)
      .order('name');
    if (result.error) throw result.error;
    businesses = result.data;
  } else {
    const result = await client
      .from('morfi_businesses')
      .select('id, name, description, logo_path, latitude, longitude, accepts_delivery, accepts_pickup, delivery_fee, is_open')
      .eq('is_published', true)
      .order('name');
    if (result.error) throw result.error;
    businesses = result.data.map(business => ({
      ...business,
      delivery_fee_status: null,
    }));
  }
  if (!businesses.length) return [];

  const businessIds = businesses.map(business => business.id);
  const { data: products, error: productsError } = await client
    .from('morfi_business_products')
    .select('id, business_id, name, description, image_path, price, is_available, accepts_delivery, payment_methods, cash_discount_percent')
    .in('business_id', businessIds)
    .eq('is_available', true);

  if (productsError) throw productsError;

  const [businessReviewsResult, productReviewsResult] = await Promise.all([
    client.from('morfi_business_review_summary')
      .select('business_id, average_rating, review_count')
      .in('business_id', businessIds),
    products.length > 0
      ? client.from('morfi_product_review_summary')
        .select('product_id, average_rating, review_count')
        .in('product_id', products.map(product => product.id))
      : Promise.resolve(null),
  ]);
  if (businessReviewsResult.error && businessReviewsResult.error.code !== 'PGRST205') {
    throw businessReviewsResult.error;
  }
  if (productReviewsResult?.error && productReviewsResult.error.code !== 'PGRST205') {
    throw productReviewsResult.error;
  }
  const businessReviewRows = businessReviewsResult.error ? [] : businessReviewsResult.data;
  const productReviewRows = productReviewsResult?.error ? [] : productReviewsResult?.data ?? [];
  const businessReviews = new Map(businessReviewRows.map(review => [
    review.business_id,
    {
      average_rating: Number(review.average_rating),
      review_count: review.review_count,
    },
  ]));
  const productReviews = new Map(productReviewRows.map(review => [
    review.product_id,
    {
      average_rating: Number(review.average_rating),
      review_count: review.review_count,
    },
  ]));

  const contacts = await Promise.all(businessIds.map(async businessId => {
    const contactResult = await client.rpc('morfi_public_business_contact', {
      p_business_id: businessId,
    });
    if (contactResult.error) throw contactResult.error;
    const contact = contactResult.data?.[0];
    return [businessId, contact
      ? {
          contact_phone: contact.contact_phone ?? null,
          contact_email: contact.contact_email ?? null,
          location: contact.location ?? null,
          directions: contact.directions ?? null,
        }
      : null] as const;
  }));
  const contactsByBusinessId = new Map(contacts);
  const productsByBusinessId = new Map<string, PublicBusinessProduct[]>();

  for (const product of products) {
    const productList = productsByBusinessId.get(product.business_id) ?? [];
    const review = productReviews.get(product.id);
    productList.push({
      ...product,
      average_rating: review?.average_rating ?? null,
      review_count: review?.review_count ?? 0,
    });
    productsByBusinessId.set(product.business_id, productList);
  }

  return businesses.map(business => {
    const review = businessReviews.get(business.id);
    return {
    business: {
      ...business,
      delivery_fee_status: isOrderCheckoutV2Enabled
        ? business.delivery_fee_status
        : null,
      logo_path: business.logo_path && !/^(https?:|data:)/i.test(business.logo_path)
        ? client.storage.from('morfi-catalog').getPublicUrl(business.logo_path).data.publicUrl
        : business.logo_path,
      average_rating: review?.average_rating ?? null,
      review_count: review?.review_count ?? 0,
    },
    products: productsByBusinessId.get(business.id) ?? [],
    contact: contactsByBusinessId.get(business.id) ?? null,
    };
  });
}
