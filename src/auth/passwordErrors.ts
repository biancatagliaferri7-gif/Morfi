export function passwordErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const details = error as Error & { code?: unknown; reasons?: unknown };
  if (details.code !== 'weak_password' && !/password.*(weak|short|breached|compromised|contain|requirements)|should be at least/i.test(error.message)) {
    return null;
  }

  const reasons = Array.isArray(details.reasons) ? details.reasons : [];
  const advice: string[] = [];
  if (reasons.includes('length')) {
    const required = error.message.match(/(?:at least|minimum of)\s+(\d+)/i)?.[1];
    advice.push(required
      ? `Usá al menos ${required} caracteres.`
      : 'Usá una contraseña más larga.');
  }
  if (reasons.includes('characters')) {
    advice.push('Incluí mayúsculas, minúsculas, números y un símbolo, como !.');
  }
  if (reasons.includes('pwned')) {
    advice.push('Esa contraseña apareció en una filtración. Elegí otra que no hayas usado antes.');
  }
  return advice.length > 0
    ? advice.join(' ')
    : 'Elegí una contraseña más larga que combine mayúsculas, minúsculas, números y un símbolo. Evitá tu DNI y contraseñas conocidas.';
}
