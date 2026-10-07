import { cn } from "@/lib/utils";

/**
 * Fondo ambiental de la partida, fijo detrás de todo. Con `cover`, la carátula difuminada tiñe la
 * pantalla (resultado); sin ella, dos halos de marca muy tenues.
 *
 * Sustituye a los mismos dos `div` con `blur-[120px]` copiados en carga, juego y resultado.
 */
export function GameBackdrop({ cover, className }: { cover?: string | null; className?: string }) {
  return (
    <div className={cn("pointer-events-none fixed inset-0 z-0 overflow-hidden", className)} aria-hidden>
      {cover ? (
        <>
          <div
            className="absolute -inset-10 scale-110 bg-cover bg-center opacity-40 blur-3xl saturate-150 animate-in fade-in-0 duration-1000 dark:opacity-35"
            style={{ backgroundImage: `url(${cover})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />
        </>
      ) : (
        <>
          <div className="absolute -left-24 -top-24 size-80 rounded-full bg-brand/10 blur-[100px]" />
          <div className="absolute -right-24 top-1/2 size-72 rounded-full bg-sky-500/8 blur-[100px]" />
        </>
      )}
    </div>
  );
}
