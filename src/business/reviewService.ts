import { supabase, publicSupabase } from '../lib/supabaseClient';

export type RatingSummary = {
  average_rating: number;
  review_count: number;
};

export type PublicReview = {
  rating: number;
  comment: string | null;
  created_at: string;
};

export type ExistingOrderReviews = {
  business: PublicReview | null;
  products: Map<string, PublicReview>;
};

function getClient(client: typeof supabase | typeof publicSupabase) {
  if (!client) {
    throw new Error('Supabase no está configurado. Revisá las variables públicas de conexión.');
  }
  return client;
}

export async function listBusinessReviews(businessId: string): Promise<PublicReview[]> {
  const { data, error } = await getClient(publicSupabase)
    .from('morfi_business_reviews')
    .select('rating, comment, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listOrderReviews(orderId: string): Promise<ExistingOrderReviews> {
  const client = getClient(supabase);
  const [businessResult, productsResult] = await Promise.all([
    client.from('morfi_business_reviews')
      .select('rating, comment, created_at')
      .eq('order_id', orderId)
      .maybeSingle(),
    client.from('morfi_product_reviews')
      .select('product_id, rating, comment, created_at')
      .eq('order_id', orderId),
  ]);
  if (businessResult.error) throw businessResult.error;
  if (productsResult.error) throw productsResult.error;
  return {
    business: businessResult.data,
    products: new Map(productsResult.data.map(review => [
      review.product_id,
      {
        rating: review.rating,
        comment: review.comment,
        created_at: review.created_at,
      },
    ])),
  };
}

export async function submitBusinessReview(
  orderId: string,
  rating: number,
  comment: string,
): Promise<void> {
  const { error } = await getClient(supabase)
    .from('morfi_business_reviews')
    .insert({
      order_id: orderId,
      rating,
      comment: comment.trim() || null,
    });
  if (error) throw error;
}

export async function submitProductReview(
  orderId: string,
  productId: string,
  rating: number,
  comment: string,
): Promise<void> {
  const { error } = await getClient(supabase)
    .from('morfi_product_reviews')
    .insert({
      order_id: orderId,
      product_id: productId,
      rating,
      comment: comment.trim() || null,
    });
  if (error) throw error;
}

