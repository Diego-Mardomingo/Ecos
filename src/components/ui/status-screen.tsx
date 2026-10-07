"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pantalla de estado a página completa (404, error, sin conexión): un vinilo con un icono encima,
 * título, texto y acciones.
 *
 * El vinilo se queda quieto y ladeado, como un disco que se ha parado: es el «algo no suena» de
 * la app, y da a estas pantallas el mismo lenguaje que el resto en lugar de un icono suelto.
 *
 * Las entradas van en CSS y no en framer-motion: con framer, lo que llegaba en el HTML del
 * servidor venía con `opacity:0` hasta hidratar (PERF-04), y una pantalla de error no debería
 * depender de que cargue más JS para verse. Las curvas con rebote imitan los muelles que tenían.
 */
export function StatusScreen({
  icon,
  tone = "neutral",
  title,
  description,
  children,
  fullHeight = true,
}: {
  icon: string;
  tone?: "neutral" | "danger";
  title: ReactNode;
  description?: ReactNode;
  /** Acciones (botones/enlaces), y opcionalmente la referencia del error. */
  children?: ReactNode;
  /** Ocupa toda la ventana (fuera del layout) o solo el hueco de la página. */
  fullHeight?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative isolate flex flex-col items-center justify-center overflow-hidden px-6 py-12 text-center",
        fullHeight ? "min-h-dvh" : "min-h-[70dvh]"
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className={cn(
            "ecos-drift-a absolute left-1/2 top-1/4 size-72 -translate-x-1/2 rounded-full blur-3xl",
            tone === "danger" ? "bg-destructive/15" : "bg-brand/15"
          )}
        />
      </div>

      <div
        className="relative mb-8 size-36 -rotate-12 animate-in fade-in zoom-in-60 spin-in-[-28deg] animation-duration-700 [--tw-ease:cubic-bezier(0.34,1.56,0.64,1)]"
        aria-hidden
      >
        <div className="ecos-vinyl size-full rounded-full shadow-[0_20px_40px_-16px_rgba(0,0,0,0.6)]">
          <div
            className={cn(
              "absolute inset-[33%] rounded-full bg-gradient-to-br",
              tone === "danger" ? "from-destructive to-rose-700" : "from-brand to-brand-dim"
            )}
          />
          <div className="absolute inset-[47%] rounded-full bg-background" />
        </div>
        <span
          className={cn(
            "absolute -bottom-1 -right-1 flex size-14 rotate-12 items-center justify-center rounded-2xl shadow-lg ring-4 ring-background",
            "animate-in zoom-in animation-duration-500 [--tw-ease:cubic-bezier(0.34,1.56,0.64,1)] [--tw-animation-delay:350ms] fill-mode-backwards",
            tone === "danger" ? "bg-destructive text-white" : "bg-card text-foreground"
          )}
        >
          <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            {icon}
          </span>
        </span>
      </div>

      <div className="max-w-sm animate-in fade-in slide-in-from-bottom-3 animation-duration-450 [--tw-ease:cubic-bezier(0.22,1,0.36,1)] [--tw-animation-delay:150ms] fill-mode-backwards">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>

      {children ? (
        <div className="mt-8 flex w-full max-w-xs flex-col items-center gap-3 animate-in fade-in slide-in-from-bottom-3 animation-duration-450 [--tw-ease:cubic-bezier(0.22,1,0.36,1)] [--tw-animation-delay:250ms] fill-mode-backwards">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Clases de los dos botones de las pantallas de estado. */
export const statusPrimaryButtonClass =
  "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand text-sm font-bold text-primary-foreground shadow-[0_12px_30px_-12px_var(--brand)] transition-transform active:scale-[0.97]";
export const statusSecondaryButtonClass =
  "flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border bg-card text-sm font-semibold transition-[transform,border-color] hover:border-brand/40 active:scale-[0.97]";
