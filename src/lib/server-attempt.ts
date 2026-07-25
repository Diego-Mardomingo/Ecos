export const MAX_ATTEMPTS = 6;

/** Fila mínima de `ecos_guesses` necesaria para decidir el número de intento. */
export interface ExistingGuessRow {
  attempt_number: number;
  guess_text: string;
}

/**
 * Decide con qué número de intento se registra y puntúa una jugada, sin fiarse del cliente.
 *
 * El `attemptNumber` del body no se puede usar tal cual: bastaba fallar cinco veces y enviar
 * `attemptNumber: 1, finalize: true` para llevarse la puntuación de acierto a la primera. La regla
 * es que **el cliente nunca puede declarar menos intentos de los que ya hay en la base de datos**.
 *
 * No se ignora del todo, porque el modo invitado guarda sus intentos solo en localStorage: quien
 * juega sin cuenta y luego inicia sesión a mitad de partida llega con un intento alto y cero filas
 * en la BD, y ahí el valor del cliente es el único dato real (y siempre en su contra).
 *
 * Un reintento exacto —mismo intento y mismo texto, p. ej. una petición repetida por un fallo de
 * red— reutiliza su número en vez de consumir otro; el upsert por `user_id,game_id,attempt_number`
 * lo hace idempotente.
 */
export function resolveServerAttempt(
  existingRows: ExistingGuessRow[],
  clientAttempt: number,
  guessText: string
): number {
  const isRetry = existingRows.some(
    (row) => row.attempt_number === clientAttempt && row.guess_text === guessText
  );
  if (isRetry) return clientAttempt;

  return Math.min(
    Math.max(existingRows.length + 1, clientAttempt),
    MAX_ATTEMPTS
  );
}
