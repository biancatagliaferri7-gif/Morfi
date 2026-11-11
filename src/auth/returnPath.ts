export function safeReturnPath(value: string | null, fallback: string) {
  if (!value?.startsWith("/") || /[\\\u0000-\u001f]/.test(value))
    return fallback;
  try {
    return new URL(value, "https://morfi.invalid").origin ===
      "https://morfi.invalid"
      ? value
      : fallback;
  } catch {
    return fallback;
  }
}
