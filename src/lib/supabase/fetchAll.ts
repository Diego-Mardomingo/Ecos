/**
 * Lectura paginada de Supabase.
 *
 * La API REST corta cualquier select en 1.000 filas sin devolver error: responde 206 con
 * `Content-Range: 0-999/N` y el cliente entrega un lote parcial indistinguible de uno completo.
 * El catálogo de admin llevaba así meses mostrando 1.000 de 1.638 canciones.
 *
 * Equivalente en TypeScript de `scripts/db_paging.py`.
 */

const PAGE_SIZE = 1000;

type Page<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

/**
 * Devuelve todas las filas del select, pidiéndolo por páginas de `pageSize`.
 *
 * `fetchPage` construye el select para un rango concreto. **Tiene que llevar un orden
 * determinista** (una columna única, o un desempate por `id` si la primera puede repetir
 * valores): Postgres no garantiza el mismo orden entre dos consultas, así que paginar sobre un
 * orden ambiguo puede repetir filas de una página y saltarse otras.
 *
 * Si el select pide `{ count: "exact" }`, al terminar se comprueba que el número de filas cuadra
 * con el total y si no se lanza un error, en vez de devolver un catálogo parcial en silencio.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  let offset = 0;

  for (;;) {
    const { data, error, count } = await fetchPage(offset, offset + pageSize - 1);
    if (error) throw new Error(`Lectura paginada fallida: ${error.message}`);

    const batch = data ?? [];
    if (total === null && count != null) total = count;
    rows.push(...batch);

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  if (total !== null && rows.length !== total) {
    throw new Error(
      `Lectura paginada incompleta: ${rows.length} filas de ${total} en total.`
    );
  }

  return rows;
}
