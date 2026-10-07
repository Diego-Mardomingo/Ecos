"use client";

import { useId, useRef } from "react";
import { m } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Selector segmentado con indicador que se desliza entre opciones.
 *
 * Con `asTabs` sigue el patrón ARIA de pestañas (tablist/tab, roving tabindex, flechas e
 * Inicio/Fin con ciclo), que es lo que necesita el ranking: sus opciones cambian el panel de
 * debajo. Sin él es un grupo de botones con `aria-pressed`, para ajustes como tema o idioma.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  asTabs = false,
  tabIdFor,
  panelId,
  size = "md",
  disabled = false,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  asTabs?: boolean;
  /** Con `asTabs`: id de cada pestaña, para que el panel la referencie con `aria-labelledby`. */
  tabIdFor?: (value: T) => string;
  panelId?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  const indicatorId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAt = (index: number) => {
    const len = options.length;
    const next = (index + len) % len;
    onChange(options[next].value);
    // Con roving tabindex el destino tiene tabIndex -1 hasta el siguiente render, pero focus()
    // programático funciona igual: -1 solo lo saca de la tabulación.
    buttonRefs.current[next]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!asTabs) return;
    const idx = options.findIndex((o) => o.value === value);
    const keyMap: Record<string, number> = {
      ArrowRight: idx + 1,
      ArrowLeft: idx - 1,
      Home: 0,
      End: options.length - 1,
    };
    if (!(e.key in keyMap)) return;
    e.preventDefault();
    selectAt(keyMap[e.key]);
  };

  return (
    <div
      role={asTabs ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative flex rounded-full bg-muted p-1 transition-opacity",
        disabled && "pointer-events-none opacity-60",
        className
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            {...(asTabs
              ? {
                  role: "tab",
                  id: tabIdFor?.(option.value),
                  "aria-selected": active,
                  "aria-controls": panelId,
                  tabIndex: active ? 0 : -1,
                }
              : { "aria-pressed": active })}
            className={cn(
              "relative flex-1 rounded-full font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <m.span
                layoutId={`${indicatorId}-indicator`}
                aria-hidden
                className="absolute inset-0 rounded-full bg-brand shadow-[0_4px_14px_-4px_var(--brand)]"
                transition={{ type: "spring", stiffness: 500, damping: 36 }}
              />
            )}
            <span className="relative whitespace-nowrap">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
