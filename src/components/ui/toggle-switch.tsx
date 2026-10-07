"use client";

import { m } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Interruptor on/off. Es un `<input type="checkbox" role="switch">` real, así que funciona con
 * teclado y lector de pantalla; el aspecto se pinta encima.
 *
 * Sustituye a las dos copias de `ToggleSwitch`/`ModalToggle` del perfil y del modal de
 * notificaciones, que no tenían nombre accesible: el texto de la fila no estaba asociado al input.
 */
export function ToggleSwitch({
  checked,
  disabled = false,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Nombre accesible del interruptor. */
  label: string;
  className?: string;
}) {
  return (
    <label className={cn("relative inline-flex cursor-pointer items-center", disabled && "cursor-not-allowed opacity-60", className)}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="block h-7 w-12 rounded-full bg-foreground/15 transition-colors duration-300 peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
      />
      <m.span
        aria-hidden
        initial={false}
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 600, damping: 32 }}
        className="absolute left-1 top-1 size-5 rounded-full bg-white shadow-md"
      />
    </label>
  );
}
