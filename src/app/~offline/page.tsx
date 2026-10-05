/**
 * Página que sirve el service worker cuando no hay red. Solo HTML y CSS, sin componentes cliente:
 * tiene que pintarse sin poder pedir nada, así que no depende de chunks de JS. Mismo lenguaje que
 * `StatusScreen` (vinilo parado y un icono), dibujado a mano.
 */
export default function OfflinePage() {
  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/4 -z-10 size-72 -translate-x-1/2 rounded-full bg-[#2bee79]/15 blur-3xl" />
      <div className="relative mb-8 size-36 -rotate-12" aria-hidden>
        <div className="ecos-vinyl relative size-full rounded-full shadow-[0_20px_40px_-16px_rgba(0,0,0,0.6)]">
          <div className="absolute inset-[33%] rounded-full bg-gradient-to-br from-[#2bee79] to-[#1abc62]" />
          <div className="absolute inset-[47%] rounded-full bg-[#0f1112]" />
        </div>
        <span className="absolute -bottom-1 -right-1 flex size-14 rotate-12 items-center justify-center rounded-2xl bg-[#181b1d] ring-4 ring-[#0f1112]">
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 8.8a15 15 0 0 1 20 0M5 12.4a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M3 3l18 18" />
          </svg>
        </span>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Sin conexión</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#a1a1aa]">
        No hay conexión a Internet. Revisa tu red e intenta de nuevo.
      </p>
    </div>
  );
}
