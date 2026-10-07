import { cn } from "@/lib/utils";

/**
 * Ecualizador decorativo (tarjeta del reto, login y «Cómo jugar»).
 *
 * Antes eran `motion.div` animando `height` con framer-motion: una animación de layout por barra
 * y por fotograma, en JS. Ahora es una animación CSS de `transform: scaleY` (`.ecos-eq-bar-center` en
 * `globals.css`) que corre en el compositor, así que ya no hace falta que sea componente cliente
 * ni que conozca el ancho de pantalla: las barras son `flex-1` y se reparten el sitio que haya.
 */

type Bar = { key: number; duration: number; delay: number; from: number; to: number };

/** Alturas y ritmos deterministas: mismo resultado en servidor y en cliente. */
function buildBars(count: number, seed: number): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    // Envolvente en campana: las barras centrales suben más, como en un espectro real.
    const center = 1 - Math.abs(i - (count - 1) / 2) / ((count - 1) / 2);
    const jitter = ((i * 7 + seed * 13) % 11) / 11;
    return {
      key: i,
      duration: 0.7 + ((i * 5 + seed) % 9) * 0.07,
      delay: -((i * 3 + seed) % 10) * 0.11,
      from: 0.12 + jitter * 0.18,
      to: 0.45 + center * 0.45 + jitter * 0.1,
    };
  });
}

const STAGE_BARS = buildBars(42, 7);

function eqStyle(bar: Bar): React.CSSProperties {
  return {
    "--eq-duration": `${bar.duration}s`,
    "--eq-delay": `${bar.delay}s`,
    "--eq-from": bar.from,
    "--eq-to": bar.to,
  } as React.CSSProperties;
}

/**
 * Ecualizador grande del escenario del reto. Las barras crecen desde el centro y llevan un
 * reflejo debajo, para que se lea como una onda y no como un gráfico de barras.
 */
function WaveformBars({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex h-full w-full items-center gap-[3px]", className)}
      aria-hidden
    >
      {STAGE_BARS.map((bar) => (
        <span
          key={bar.key}
          className="ecos-eq-bar-center h-full flex-1 rounded-full bg-gradient-to-t from-brand/25 via-brand to-brand/25"
          style={eqStyle(bar)}
        />
      ))}
    </div>
  );
}

export { WaveformBars };
