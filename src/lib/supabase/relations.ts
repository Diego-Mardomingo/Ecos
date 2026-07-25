/**
 * PostgREST devuelve las relaciones embebidas to-one como objeto (o `null`), pero los tipos
 * generados en `src/types/supabase.ts` las declaran como array. Ese desajuste se venía tapando con
 * un `as unknown as` en cada consulta, que además silenciaba cualquier otro error de forma.
 *
 * Este es el único sitio donde se resuelve, y lo hace comprobando el valor en runtime en vez de
 * mentirle al compilador: si algún día llega de verdad como array, sigue funcionando.
 */
export function unwrapToOne<T>(relation: T | T[] | null | undefined): T | null {
  if (relation == null) return null;
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}
