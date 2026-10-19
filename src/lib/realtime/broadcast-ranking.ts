import { after } from "next/server";
import {
  CATEGORY_RANKING_BROADCAST_EVENT,
  RANKING_BROADCAST_EVENT,
  RANKING_BROADCAST_TOPIC,
  categoryRankingTopic,
} from "./ranking-channel";

/**
 * Avisa por Supabase Realtime (Broadcast) a quien tenga abierto un ranking (el diario o el de una
 * categoría) de que ha cambiado. Solo para código de servidor: usa la service role key.
 *
 * Es un POST al endpoint REST de Realtime, sin abrir ningún websocket. Nunca falla hacia fuera ni
 * retrasa la respuesta: la partida ya está guardada y el aviso es un extra, así que se lanza con
 * `after()` (después de responder) y cualquier error se queda en el log.
 */

const BROADCAST_TIMEOUT_MS = 3000;

async function sendBroadcast(topic: string, event: string): Promise<void> {
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
        messages: [{ topic, event, payload: {}, private: true }],
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

function dispatch(topic: string, event: string): void {
  const task = sendBroadcast(topic, event);
  try {
    after(task);
  } catch {
    // Fuera del ámbito de una petición `after()` no existe: la promesa sigue su curso igualmente.
  }
}

/** Emite «el ranking ha cambiado». Llamar justo después de cerrar una partida con éxito. */
export function notifyRankingChanged(): void {
  dispatch(RANKING_BROADCAST_TOPIC, RANKING_BROADCAST_EVENT);
}

/** Emite «la clasificación de esta categoría ha cambiado». Llamar al terminar una partida con puntos. */
export function notifyCategoryRankingChanged(slug: string): void {
  dispatch(categoryRankingTopic(slug), CATEGORY_RANKING_BROADCAST_EVENT);
}
