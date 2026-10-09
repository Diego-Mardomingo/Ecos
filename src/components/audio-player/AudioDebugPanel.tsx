"use client";

import { useState, useSyncExternalStore } from "react";
import {
  clearAudioDebug,
  formatAudioDebugReport,
  getAudioDebugServerState,
  getAudioDebugState,
  subscribeAudioDebug,
  type AudioDebugPlay,
} from "@/lib/audio/audioDebug";

/**
 * Panel flotante del diagnóstico de audio (`?audioDebug=1`). Herramienta interna: va en español
 * sin i18n, como `/admin`, y solo se carga con el diagnóstico activo (ver `AppLayoutClient`).
 */

function formatPlay(play: AudioDebugPlay): string {
  const deviation =
    play.wallPlayed !== null ? `${Math.round((play.wallPlayed - play.expected) * 1000)} ms` : "-";
  return `${play.expected} s · toque→sonido ${play.tapToPlayingMs ?? "-"} ms · cabezal ${play.mediaPlayed ?? "-"} s · reloj ${play.wallPlayed ?? "-"} s (${deviation})`;
}

async function copyReport(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AudioDebugPanel() {
  const debug = useSyncExternalStore(subscribeAudioDebug, getAudioDebugState, getAudioDebugServerState);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const lastPlay = debug.plays[0];
  const lastLoad = debug.loads[0];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-2 right-2 z-[70] max-w-[90vw] truncate rounded-full bg-black/85 px-3 py-1.5 font-mono text-[10px] text-white shadow-lg"
      >
        audio · {lastPlay ? formatPlay(lastPlay) : lastLoad ? `listo en ${lastLoad.canPlayThroughMs ?? "…"} ms` : "sin datos"}
      </button>
    );
  }

  return (
    <div className="fixed inset-x-2 bottom-2 z-[70] max-h-[55dvh] overflow-y-auto rounded-xl bg-black/90 p-3 font-mono text-[10px] leading-relaxed text-white shadow-2xl">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-1 font-bold">Diagnóstico de audio</span>
        <button
          type="button"
          className="rounded bg-white/15 px-2 py-1"
          onClick={() => {
            void copyReport(formatAudioDebugReport(debug)).then(setCopied);
          }}
        >
          {copied === null ? "Copiar" : copied ? "Copiado" : "No se pudo"}
        </button>
        <button type="button" className="rounded bg-white/15 px-2 py-1" onClick={clearAudioDebug}>
          Limpiar
        </button>
        <button type="button" className="rounded bg-white/15 px-2 py-1" onClick={() => setOpen(false)}>
          Cerrar
        </button>
      </div>

      <p className="font-bold text-white/70">Cargas (ms desde que se crea el audio)</p>
      {debug.loads.map((load, index) => (
        <p key={`${load.game}-${index}`}>
          {load.game} · metadata {load.metadataMs ?? "-"} · datos {load.loadedDataMs ?? "-"} · completo{" "}
          {load.canPlayThroughMs ?? "-"}
          {load.errors > 0 ? ` · errores ${load.errors}` : ""}
        </p>
      ))}

      <p className="mt-2 font-bold text-white/70">Fragmentos</p>
      {debug.plays.map((play, index) => (
        <p key={`${play.game}-${index}`}>
          {play.game} · {formatPlay(play)}
        </p>
      ))}

      <p className="mt-2 font-bold text-white/70">Descargas</p>
      {debug.downloads.map((download, index) => (
        <p key={`${download.name}-${index}`}>
          {download.name} · {download.transferKb ?? "?"} KB · caché {String(download.fromCache ?? "?")} · ttfb{" "}
          {download.ttfbMs ?? "?"} ms · total {download.durationMs} ms
        </p>
      ))}

      <p className="mt-2 font-bold text-white/70">Eventos</p>
      {debug.events.map((event, index) => (
        <p key={`${event.at}-${index}`} className="text-white/80">
          {event.at} · {event.game} · {event.event} · {event.detail}
        </p>
      ))}
    </div>
  );
}
