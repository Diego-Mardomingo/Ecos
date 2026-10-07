"use client";

import { useTranslations } from "next-intl";
import { m } from "framer-motion";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store/authStore";
import { useProfileCore } from "@/lib/hooks/queries";
import { Link } from "@/i18n/navigation";
import { useNavPrefetch } from "@/components/navigation/useNavPrefetch";

/**
 * Navegación lateral (tablet y escritorio, ≥670 px). Mismas pestañas y mismo comportamiento que
 * `BottomNav` (ver `useNavPrefetch`); la activa se marca con una pastilla que se desliza.
 */

const NAV_ITEMS = [
  { href: "/", labelKey: "play", icon: "play_circle" },
  { href: "/ranking", labelKey: "ranking", icon: "leaderboard" },
] as const;

/** Alto de cada fila y hueco entre filas (px). La pastilla se coloca con estas medidas. */
const ITEM_HEIGHT = 46;
const ITEM_GAP = 4;

export function SidebarNav() {
  const t = useTranslations("nav");
  const user = useAuthStore((s) => s.user);
  // Solo el núcleo del perfil: nombre y avatar. Antes se pedían también las estadísticas.
  const { data } = useProfileCore(user?.id ?? null);
  const { isActive, handleNavClick } = useNavPrefetch();

  const profileLabel = user ? (data?.profile?.display_name ?? t("profile")) : t("profile");
  const avatarUrl = user ? data?.profile?.avatar_url : undefined;
  const profileActive = isActive("/profile");
  const activeIndex = NAV_ITEMS.findIndex((item) => isActive(item.href));

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-card/60 backdrop-blur-xl min-[670px]:flex">
      <div className="px-5 pb-6 pt-6">
        <Link href="/" className="group inline-flex items-center gap-2.5">
          <span className="relative grid size-10 place-items-center overflow-hidden rounded-xl bg-brand/15 ring-1 ring-brand/30 transition-transform duration-300 group-hover:-rotate-6">
            <Image src="/ecos_icon_v2_192.png" alt="" width={40} height={40} className="object-contain" />
          </span>
          <span className="font-display text-[23px] font-extrabold leading-none tracking-[-0.04em]">ecos</span>
        </Link>
      </div>

      <nav aria-label={t("mainLabel")} className="flex-1 px-3">
        <ul className="relative flex flex-col" style={{ gap: ITEM_GAP }}>
          {/* Pastilla de la pestaña activa: una sola, desplazada en Y hasta su fila. Mismo motivo que
              en `BottomNav`: un `layoutId` mide posiciones de página, y en una barra `sticky` el
              salto de scroll al cambiar de ruta se colaba en la animación. */}
          <m.span
            aria-hidden
            initial={false}
            animate={{ y: Math.max(0, activeIndex) * (ITEM_HEIGHT + ITEM_GAP), opacity: activeIndex >= 0 ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 38 }}
            className="absolute inset-x-0 top-0 rounded-2xl bg-brand/12 ring-1 ring-brand/25"
            style={{ height: ITEM_HEIGHT }}
          />
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch
                  aria-current={active ? "page" : undefined}
                  onClick={(e) => handleNavClick(item.href, e)}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl px-3.5 text-sm font-semibold transition-colors",
                    active ? "text-brand" : "text-muted-foreground hover:text-foreground"
                  )}
                  style={{ height: ITEM_HEIGHT }}
                >
                  <span
                    aria-hidden
                    className="material-symbols-outlined relative text-[22px] leading-none transition-transform duration-200 group-hover:scale-110"
                    style={{ fontVariationSettings: `'FILL' ${active ? 1 : 0}, 'wght' 500` }}
                  >
                    {item.icon}
                  </span>
                  <span className="relative">{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-3">
        <Link
          href="/profile"
          // Sin sesión redirige a /login: no se precarga (ver `BottomNav`).
          prefetch={user != null}
          aria-current={profileActive ? "page" : undefined}
          onClick={(e) => handleNavClick("/profile", e)}
          className={cn(
            "group flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors",
            profileActive ? "border-brand/30 bg-brand/10" : "border-border bg-background/50 hover:border-brand/30"
          )}
        >
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center overflow-hidden rounded-full ring-2",
              profileActive ? "ring-brand" : "ring-border"
            )}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar externo pequeño
              <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
            ) : (
              <span aria-hidden className="material-symbols-outlined text-xl text-muted-foreground">
                person
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{profileLabel}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {user ? t("account") : t("guest")}
            </span>
          </span>
          <span aria-hidden className="material-symbols-outlined text-lg text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5">
            chevron_right
          </span>
        </Link>
      </div>
    </aside>
  );
}
