"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store/authStore";
import { useProfileCore } from "@/lib/hooks/queries";
import { Link } from "@/i18n/navigation";
import { useNavPrefetch } from "@/components/navigation/useNavPrefetch";

/**
 * Barra de navegación inferior (móvil): Ranking · Jugar · Perfil, en una cápsula flotante.
 * La pestaña activa se invierte (fondo del color del texto) y la pastilla se desliza de una a
 * otra. Con sesión, la de perfil lleva el nombre del usuario; sin ella, «Entrar».
 */
const ITEMS = [
  { href: "/ranking", icon: "leaderboard", labelKey: "ranking" },
  { href: "/", icon: "play_circle", labelKey: "play" },
  { href: "/profile", icon: "person", labelKey: "profile" },
] as const;

/** Ancho de cada pestaña y hueco entre ellas (px). La pastilla se coloca con estas medidas. */
const TAB_WIDTH = 74;
const TAB_GAP = 4;

export function BottomNav() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const user = useAuthStore((s) => s.user);
  // Solo el núcleo del perfil: el nombre de la pestaña. Antes se pedían también las estadísticas.
  const { data } = useProfileCore(user?.id ?? null);
  const { isActive, handleNavClick } = useNavPrefetch();

  const profileLabel = user ? (data?.profile?.display_name ?? t("profile")) : tc("enter");
  const activeIndex = ITEMS.findIndex((item) => isActive(item.href));

  return (
    <nav
      aria-label={t("mainLabel")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] min-[670px]:hidden"
    >
      {/* El fundido de entrada va en CSS: con framer, la barra llegaba con `opacity:0` en el HTML
          del servidor y no se veía hasta hidratar (PERF-04). */}
      <div
        className="pointer-events-auto relative flex animate-in items-center rounded-[26px] border border-border p-1.5 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.35)] backdrop-blur-[18px] backdrop-saturate-[1.4] fade-in animation-duration-250"
        style={{ background: "color-mix(in srgb, var(--card) 80%, transparent)", gap: TAB_GAP }}
      >
        {/* Pastilla de la pestaña activa. Una sola, desplazada en X hasta su pestaña, en vez de un
            `layoutId` que salta de una pestaña a otra: el `layoutId` mide posiciones de página, y
            como la nav es `position: fixed`, el salto de scroll al cambiar de ruta se colaba en la
            animación y la pastilla llegaba «desde abajo de la pantalla» (medido: 537 px). Con las
            pestañas de ancho fijo, la posición se calcula y el scroll no interviene. */}
        <motion.span
          aria-hidden
          initial={false}
          animate={{ x: Math.max(0, activeIndex) * (TAB_WIDTH + TAB_GAP), opacity: activeIndex >= 0 ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
          className="absolute bottom-1.5 left-1.5 top-1.5 rounded-[20px] bg-foreground"
          style={{ width: TAB_WIDTH }}
        />
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          const label = item.labelKey === "profile" ? profileLabel : t(item.labelKey);
          return (
            <Link
              key={item.href}
              href={item.href}
              // Sin sesión, «Entrar» lleva a /profile, que redirige a /login: precargarlo
              // renderizaba la página de login entera en cada carga (PDATA-04).
              prefetch={item.href !== "/profile" || user != null}
              onClick={(e) => handleNavClick(item.href, e)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center gap-0.5 rounded-[20px] pb-1.5 pt-[7px] text-[10.5px] font-semibold transition-colors duration-200",
                active ? "text-background" : "text-muted-foreground hover:text-foreground"
              )}
              style={{ width: TAB_WIDTH }}
            >
              <motion.span
                aria-hidden
                whileTap={{ scale: 0.85 }}
                className="material-symbols-outlined relative text-2xl"
                style={{ fontVariationSettings: `'FILL' ${active ? 1 : 0}, 'wght' 500` }}
              >
                {item.icon}
              </motion.span>
              <span className="relative max-w-full truncate px-1">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
