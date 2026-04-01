/** Año de lanzamiento a partir de release_date (ISO YYYY-MM-DD o prefijo numérico). */
export function releaseYearFromReleaseDate(releaseDate: string | null | undefined): string | null {
  if (!releaseDate?.trim()) return null;
  const m = /^(\d{4})/.exec(releaseDate.trim());
  return m ? m[1] : null;
}
