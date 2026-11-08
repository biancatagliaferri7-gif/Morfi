export function isReviewSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = error as { code?: unknown; message?: unknown };
  return details.code === 'PGRST205' ||
    (typeof details.message === 'string' && /morfi_(business|product)_reviews|review_summary.*schema cache/i.test(details.message));
}
