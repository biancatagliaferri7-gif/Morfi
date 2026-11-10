function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '';
}

export function messageForOrderError(error: unknown): string {
  const message = errorMessage(error);
  const shortage = /^Insufficient finished stock for product (.+)$/i.exec(message);
  if (shortage) return `${shortage[1]} está agotado o no tiene unidades suficientes. Quitalo del carrito o consultá al comercio.`;
  if (/Finished stock changed while placing the order/i.test(message)) {
    return 'El stock cambió mientras confirmabas. Revisá el carrito e intentá de nuevo.';
  }
  if (/Business is unavailable/i.test(message)) return 'El emprendimiento no está recibiendo pedidos en este momento.';
  if (/A product is unavailable or does not belong/i.test(message)) return 'Un producto del carrito ya no está disponible. Volvé al menú y elegí otro.';
  if (/selected payment method/i.test(message)) return 'El comercio no acepta ese medio de pago para todos los productos.';
  if (/public WhatsApp contact is required/i.test(message)) return 'El comercio todavía no configuró su WhatsApp para recibir pedidos.';
  if (error instanceof Error && message) return message;
  return 'No pudimos registrar el pedido. Revisá el carrito e intentá nuevamente.';
}
