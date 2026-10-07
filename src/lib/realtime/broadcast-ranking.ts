import { after } from "next/server";
import { RANKING_BROADCAST_EVENT, RANKING_BROADCAST_TOPIC } from "./ranking-channel";

/**
 * Avisa por Supabase Realtime (Broadcast) a quien tenga abierto el ranking de que se ha cerrado
 * una partida. Solo para código de servidor: usa la service role key.
 *
 * Es un POST al endpoint REST de Realtime, sin abrir ningún websocket. Nunca falla hacia fuera ni
 * retrasa la respuesta: la partida ya está guardada y el aviso es un extra, así que se lanza con
 * `after()` (después de responder) y cualquier error se queda en el log.
 */

const BROADCAST_TIMEOUT_MS = 3000;

async function sendRankingBroadcast(): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: RANKING_BROADCAST_TOPIC,
            event: RANKING_BROADCAST_EVENT,
            payload: {},
            private: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`ranking broadcast: Realtime respondió ${res.status}`, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("ranking broadcast error:", err);
  }
}

/** Emite «el ranking ha cambiado». Llamar justo después de cerrar una partida con éxito. */
export function notifyRankingChanged(): void {
  const task = sendRankingBroadcast();
  try {
    after(task);
  } catch {
    // Fuera del ámbito de una petición `after()` no existe: la promesa sigue su curso igualmente.
  }
}
