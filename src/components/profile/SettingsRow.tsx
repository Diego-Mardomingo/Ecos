import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fila de un grupo de ajustes: icono en una pastilla de color, etiqueta y el control a la derecha.
 * Para filas que navegan o ejecutan una acción, ver `SettingsLinkRow` en `ProfileClient`.
 */
export function SettingsRow({
  icon,
  iconClass,
  label,
  description,
  children,
  className,
}: {
  icon: string;
  /** Fondo y color del icono, p. ej. `bg-brand/15 text-brand`. */
  iconClass: string;
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-14 items-center gap-3 px-4 py-3", className)}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", iconClass)}>
        <span aria-hidden className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
          {icon}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

/** Grupo de filas con título, en una tarjeta con separadores. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card">{children}</div>
    </section>
  );
}
