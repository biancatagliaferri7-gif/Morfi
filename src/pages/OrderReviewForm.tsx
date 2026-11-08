import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  listOrderReviews,
  submitBusinessReview,
  submitProductReview,
} from '../business/reviewService';
import type { ExistingOrderReviews, PublicReview } from '../business/reviewService';
import type { MealOrder } from '../orders/orderService';

function StarPicker({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (rating: number) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map(rating => (
        <button
          key={rating}
          type="button"
          role="radio"
          aria-checked={value === rating}
          aria-label={`${rating} ${rating === 1 ? 'estrella' : 'estrellas'}`}
          onClick={() => onChange(rating)}
          className={`text-2xl ${rating <= value ? 'text-amber-500' : 'text-gray-300'}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function existingRating(review: PublicReview) {
  return (
    <p className="mt-2 text-sm text-green-800" role="status">
      Calificaste con {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
      {review.comment ? ` · ${review.comment}` : ''}
    </p>
  );
}

function reviewErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Error inesperado.';
  if (/duplicate|unique/i.test(message)) return 'Esta compra ya tiene una calificación registrada.';
  if (/delivered|delivered orders/i.test(message)) return 'Solo se pueden calificar pedidos entregados.';
  if (/product|order/i.test(message)) return 'No se pudo validar la compra para esta calificación.';
  return `No se pudo guardar la calificación: ${message}`;
}

export default function OrderReviewForm({
  order,
  onSubmitted,
}: {
  order: MealOrder;
  onSubmitted: () => void;
}) {
  const [existing, setExisting] = useState<ExistingOrderReviews | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [businessRating, setBusinessRating] = useState(0);
  const [businessComment, setBusinessComment] = useState('');
  const [productRatings, setProductRatings] = useState<Record<string, number>>({});
  const [productComments, setProductComments] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    async function loadReviews() {
      setLoading(true);
      setError('');
      try {
        const reviews = await listOrderReviews(order.id);
        if (active) setExisting(reviews);
      } catch (caught) {
        if (active) setError(`No se pudo consultar si ya calificaste esta compra: ${reviewErrorMessage(caught)}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadReviews();
    return () => {
      active = false;
    };
  }, [order.id]);

  async function saveBusinessReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (businessRating < 1 || businessRating > 5) {
      setError('Elegí de 1 a 5 estrellas para calificar el emprendimiento.');
      return;
    }
    setBusyKey('business');
    setError('');
    setNotice('');
    try {
      await submitBusinessReview(order.id, businessRating, businessComment);
      setExisting(current => current
        ? { ...current, business: { rating: businessRating, comment: businessComment.trim() || null, created_at: new Date().toISOString() } }
        : current);
      setNotice('Calificación del emprendimiento guardada.');
      onSubmitted();
    } catch (caught) {
      setError(reviewErrorMessage(caught));
    } finally {
      setBusyKey('');
    }
  }

  async function saveProductReview(
    event: FormEvent<HTMLFormElement>,
    productId: string,
  ) {
    event.preventDefault();
    const rating = productRatings[productId] ?? 0;
    const comment = productComments[productId] ?? '';
    if (rating < 1 || rating > 5) {
      setError('Elegí de 1 a 5 estrellas para calificar el producto.');
      return;
    }
    setBusyKey(productId);
    setError('');
    setNotice('');
    try {
      await submitProductReview(order.id, productId, rating, comment);
      setExisting(current => {
        if (!current) return current;
        const products = new Map(current.products);
        products.set(productId, {
          rating,
          comment: comment.trim() || null,
          created_at: new Date().toISOString(),
        });
        return { ...current, products };
      });
      setNotice('Calificación del producto guardada.');
      onSubmitted();
    } catch (caught) {
      setError(reviewErrorMessage(caught));
    } finally {
      setBusyKey('');
    }
  }

  return (
    <section className="mt-4 border-t pt-4" aria-label="Calificar pedido entregado">
      <h3 className="font-bold">¿Cómo estuvo tu experiencia?</h3>
      {loading && <p className="mt-2 text-sm text-gray-500" role="status">Cargando calificaciones…</p>}
      {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {notice && <p className="mt-2 rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{notice}</p>}
      {!loading && existing && (
        <div className="mt-3 space-y-4">
          <form onSubmit={event => void saveBusinessReview(event)} className="rounded-lg bg-[#FFF9F2] p-3">
            <h4 className="font-semibold">Calificar emprendimiento</h4>
            {existing.business
              ? existingRating(existing.business)
              : <>
                  <StarPicker value={businessRating} onChange={setBusinessRating} label="Estrellas del emprendimiento" />
                  <label className="mt-2 block text-sm">
                    Opinión (opcional)
                    <textarea
                      value={businessComment}
                      onChange={event => setBusinessComment(event.target.value)}
                      maxLength={1000}
                      rows={2}
                      className="mt-1 w-full rounded-lg border p-2"
                    />
                  </label>
                  <button disabled={busyKey === 'business'} className="mt-2 rounded-lg bg-[#8B3F14] px-4 py-2 font-bold text-white disabled:opacity-50">
                    {busyKey === 'business' ? 'Guardando…' : 'Enviar calificación'}
                  </button>
                </>}
          </form>
          {order.items.map(item => {
            const review = existing.products.get(item.product_id);
            return (
              <form
                key={item.product_id}
                onSubmit={event => void saveProductReview(event, item.product_id)}
                className="rounded-lg border p-3"
              >
                <h4 className="font-semibold">Calificar {item.product_name}</h4>
                {review
                  ? existingRating(review)
                  : <>
                      <StarPicker
                        value={productRatings[item.product_id] ?? 0}
                        onChange={rating => setProductRatings(current => ({ ...current, [item.product_id]: rating }))}
                        label={`Estrellas de ${item.product_name}`}
                      />
                      <label className="mt-2 block text-sm">
                        Opinión (opcional)
                        <textarea
                          value={productComments[item.product_id] ?? ''}
                          onChange={event => setProductComments(current => ({ ...current, [item.product_id]: event.target.value }))}
                          maxLength={1000}
                          rows={2}
                          className="mt-1 w-full rounded-lg border p-2"
                        />
                      </label>
                      <button disabled={busyKey === item.product_id} className="mt-2 rounded-lg bg-[#8B3F14] px-4 py-2 font-bold text-white disabled:opacity-50">
                        {busyKey === item.product_id ? 'Guardando…' : 'Enviar calificación'}
                      </button>
                    </>}
              </form>
            );
          })}
        </div>
      )}
    </section>
  );
}

