"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { AnimatePresence, m, useDragControls, type PanInfo } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Hoja inferior al estilo de iOS: sube desde abajo, se cierra arrastrándola hacia abajo por el asa
 * (o tocando fuera, o con Escape) y deja ver la página oscurecida detrás.
 *
 * Por debajo es un `Dialog` de Radix, así que conserva lo que da un diálogo accesible: foco
 * atrapado, Escape, `aria-modal`, título y descripción enlazados. La animación va con
 * framer-motion porque las de Radix (CSS) no permiten arrastrar.
 *
 * El arrastre solo empieza en la cabecera (`dragListener={false}` + `dragControls`): si toda la
 * hoja fuera arrastrable, desplazar el contenido largo o seleccionar texto la movería.
 */

/** Distancia (px) o velocidad (px/s) hacia abajo a partir de la cual soltar la hoja la cierra. */
const DISMISS_OFFSET_PX = 110;
const DISMISS_VELOCITY = 600;

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  hideDescription = false,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** La descripción solo para lectores de pantalla. */
  hideDescription?: boolean;
  children: ReactNode;
  /** Zona fija al pie (botón principal), fuera del área que desplaza. */
  footer?: ReactNode;
  className?: string;
}) {
  const tc = useTranslations("common");
  const dragControls = useDragControls();

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_OFFSET_PX || info.velocity.y > DISMISS_VELOCITY) {
      onOpenChange(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <m.div
                className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[3px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              forceMount
              // La descripción es opcional: sin ella, Radix avisaría por consola.
              {...(description ? {} : { "aria-describedby": undefined })}
            >
              <m.div
                className={cn(
                  "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[28px] border border-b-0 border-border bg-card shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.5)] outline-none",
                  className
                )}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                // Muelle sin rebote: como las hojas de iOS, llega rápido y se asienta.
                transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
                drag="y"
                dragListener={false}
                dragControls={dragControls}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.05, bottom: 0.8 }}
                onDragEnd={handleDragEnd}
              >
                {/* Cabecera: asa + título. Es la zona desde la que se arrastra. */}
                <div
                  className="shrink-0 cursor-grab touch-none select-none px-5 pb-3 pt-2.5 active:cursor-grabbing"
                  onPointerDown={(e) => dragControls.start(e)}
                >
                  <div aria-hidden className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-foreground/20" />
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <DialogPrimitive.Title className="font-display text-[22px] font-bold leading-tight tracking-[-0.02em]">
                        {title}
                      </DialogPrimitive.Title>
                      {description ? (
                        <DialogPrimitive.Description
                          className={cn("mt-1 text-sm leading-relaxed text-muted-foreground", hideDescription && "sr-only")}
                        >
                          {description}
                        </DialogPrimitive.Description>
                      ) : null}
                    </div>
                    <DialogPrimitive.Close
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-[color,transform] hover:text-foreground active:scale-90"
                      aria-label={tc("close")}
                    >
                      <span aria-hidden className="material-symbols-outlined text-lg">close</span>
                    </DialogPrimitive.Close>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>

                {footer ? (
                  <div className="shrink-0 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                    {footer}
                  </div>
                ) : (
                  <div className="h-[env(safe-area-inset-bottom)] shrink-0" aria-hidden />
                )}
              </m.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
