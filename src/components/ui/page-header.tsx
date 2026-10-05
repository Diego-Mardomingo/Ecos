"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Cabecera de página: pegajosa y translúcida, con volver opcional a la izquierda, título (y
 * subtítulo) y un hueco para una acción a la derecha.
 *
 * El título va alineado a la izquierda y grande en las páginas raíz (ranking, perfil), como un
 * título de sección; con botón de volver pasa al centro y se encoge, como en una subpágina.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  backHref,
  backLabel,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Texto pequeño en mayúsculas sobre el título (solo en páginas raíz). */
  eyebrow?: ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  className?: string;
}) {
  const isSubpage = Boolean(backHref);

  return (
    <header
      className={cn("sticky top-0 z-30 -mx-4 px-4 pb-3 backdrop-blur-xl", className)}
      style={{ background: "color-mix(in srgb, var(--background) 80%, transparent)" }}
    >
      <div className={cn("flex min-h-14 items-center gap-3", isSubpage ? "pt-2" : "pt-3")}>
        {isSubpage ? (
          <Link
            href={backHref!}
            aria-label={backLabel}
            className="group flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 transition-[transform,border-color] duration-200 hover:border-brand/40 active:scale-90"
          >
            <span aria-hidden className="material-symbols-outlined text-xl transition-transform duration-200 group-hover:-translate-x-0.5">
              arrow_back
            </span>
          </Link>
        ) : null}

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className={cn("min-w-0 flex-1", isSubpage && "text-center")}
        >
          {eyebrow && !isSubpage ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
          ) : null}
          <h1
            className={cn(
              "truncate font-bold tracking-tight",
              isSubpage ? "text-base leading-tight" : "text-[26px] leading-tight"
            )}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className={cn("truncate text-muted-foreground", isSubpage ? "text-xs" : "text-sm")}>{subtitle}</p>
          ) : null}
        </motion.div>

        {/* Con volver, el hueco derecho iguala al botón para que el título quede centrado. */}
        {action ? (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        ) : isSubpage ? (
          <div className="size-10 shrink-0" aria-hidden />
        ) : null}
      </div>
    </header>
  );
}

/** Botón redondo de icono para el hueco `action` de la cabecera. */
export function HeaderIconLink({
  href,
  icon,
  label,
  className,
}: {
  href: string;
  icon: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(
        "group flex size-10 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground shadow-sm backdrop-blur transition-[color,border-color,transform] duration-200 hover:border-brand/40 hover:text-foreground active:scale-90",
        className
      )}
    >
      <span aria-hidden className="material-symbols-outlined text-[22px] transition-transform duration-300 group-hover:-rotate-12">
        {icon}
      </span>
    </Link>
  );
}
