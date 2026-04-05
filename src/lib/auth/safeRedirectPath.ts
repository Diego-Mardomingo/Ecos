/**
 * Valida un destino post-login para evitar open redirects.
 * Solo rutas relativas internas (mismo sitio).
 */
export function getSafeRedirectTarget(candidate: string | undefined | null): string | null {
  if (candidate == null || typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.includes("://")) return null;
  if (trimmed.includes("@")) return null;
  return trimmed;
}
