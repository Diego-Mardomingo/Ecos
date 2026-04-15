"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useTheme } from "next-themes";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { format } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile } from "@/lib/hooks/queries";
import type { UserStats } from "@/lib/queries/users";
import { LanguageSelector } from "@/components/profile/LanguageSelector";
import { cn } from "@/lib/utils";
import { ProfileSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";

interface Profile {
  id: string;
  display_name: string;
  avatar_url: string;
  show_avatar_in_rankings: boolean;
  created_at: string;
  email: string;
  role: string | null;
}

interface Props {
  initialData?: {
    profile: Profile;
    stats: UserStats | null;
  };
}

const SECTION_STAGGER = 0.05;
const STATS_STAGGER = 0.035;

export function ProfileClient({ initialData }: Props) {
  const profileUserId = initialData?.profile.id ?? null;
  const { data, isLoading, coreError, refetch } = useProfile(
    profileUserId,
    initialData
  );
  const profile = data?.profile ?? {
    id: "",
    display_name: "",
    avatar_url: "",
    show_avatar_in_rankings: true,
    created_at: "",
    email: "",
    role: null,
  };
  const stats = data?.stats ?? null;

  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const locale = useLocale();

  // Evitar hydration mismatch: el tema se lee de localStorage solo en el cliente
  useEffect(() => setMounted(true), []);
  const dateFnsLocale = locale === "es" ? es : enUS;

  if (isLoading && !data) {
    return <ProfileSkeleton />;
  }

  if (coreError && !data) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 pb-28 pt-12">
        <p className="text-center text-sm text-muted-foreground">{tc("error")}</p>
        <Button type="button" variant="secondary" onClick={() => void refetch()}>
          {tc("retry")}
        </Button>
      </div>
    );
  }

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem("ecos-game-progress");
    localStorage.removeItem("ecos-game-state");
    window.location.href = "/";
  };

  const memberSince = profile.created_at
    ? format(new Date(profile.created_at), "MMMM yyyy", { locale: dateFnsLocale })
    : "";

  const pageVariants: Variants = prefersReducedMotion
    ? {
        hidden: { opacity: 1 },
        visible: { opacity: 1 },
      }
    : {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            when: "beforeChildren",
            staggerChildren: SECTION_STAGGER,
          },
        },
      };

  const sectionVariants: Variants = prefersReducedMotion
    ? {
        hidden: { opacity: 1, y: 0 },
        visible: { opacity: 1, y: 0 },
      }
    : {
        hidden: { opacity: 0, y: 4, scale: 0.992 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: {
            type: "spring",
            stiffness: 250,
            damping: 30,
            mass: 0.85,
          },
        },
      };

  const statsGridVariants: Variants = prefersReducedMotion
    ? {
        hidden: { opacity: 1 },
        visible: { opacity: 1 },
      }
    : {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: STATS_STAGGER },
        },
      };

  const statItemVariants: Variants = prefersReducedMotion
    ? {
        hidden: { opacity: 1, y: 0, scale: 1 },
        visible: { opacity: 1, y: 0, scale: 1 },
      }
    : {
        hidden: { opacity: 0, y: 8, scale: 0.97 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: {
            type: "spring",
            stiffness: 290,
            damping: 31,
            mass: 0.8,
          },
        },
      };

  const statCards = [
    {
      icon: "percent",
      iconBg: "bg-blue-500/15",
      iconColor: "text-blue-400",
      value: stats?.games_played
        ? `${Math.round(((stats?.games_won ?? 0) / stats.games_played) * 100)}%`
        : "0%",
      label: t("stats.hitRate"),
    },
    {
      icon: "check_circle",
      iconBg: "bg-green-500/15",
      iconColor: "text-green-700 dark:text-green-400",
      value: stats?.games_won ?? 0,
      label: t("stats.guessed"),
    },
    {
      icon: "flag",
      iconBg: "bg-violet-500/15",
      iconColor: "text-violet-400",
      value: stats?.games_played ?? 0,
      label: t("stats.completed"),
    },
    {
      icon: "analytics",
      iconBg: "bg-amber-500/15",
      iconColor: "text-amber-400",
      value: typeof stats?.avg_guesses === "number" ? stats.avg_guesses.toFixed(1) : "0",
      label: t("stats.avgAttempts"),
    },
    {
      icon: "local_fire_department",
      iconBg: "bg-orange-500/15",
      iconColor: "text-orange-400",
      value: stats?.streak ?? 0,
      label: t("stats.currentStreak"),
      suffix: tc("days"),
    },
    {
      icon: "whatshot",
      iconBg: "bg-red-500/15",
      iconColor: "text-red-400",
      value: stats?.max_streak ?? 0,
      label: t("stats.maxStreak"),
      suffix: tc("days"),
    },
  ] as const;

  return (
    <motion.div
      className="flex min-h-full flex-col gap-5 px-4 pb-28"
      initial="hidden"
      animate="visible"
      variants={pageVariants}
    >
      {/* Header */}
      <motion.header
        className="py-3 text-center text-base font-bold"
        variants={sectionVariants}
      >
        {t("title")}
      </motion.header>

      {/* Avatar + info */}
      <motion.section
        className="flex flex-col items-center gap-3 py-4"
        variants={sectionVariants}
      >
        <Avatar className="h-24 w-24 ring-2 ring-brand/40">
          <AvatarImage src={profile.avatar_url} />
          <AvatarFallback className="bg-secondary text-2xl font-bold">
            {profile.display_name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          <h2 className="text-xl font-bold">{profile.display_name}</h2>
          {memberSince && (
            <p className="text-sm text-muted-foreground">
              {t("memberSince")} {memberSince}
            </p>
          )}
          <div className="mt-2 flex flex-col items-center gap-1">
            <motion.span
              className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-3 py-0.5 text-xs font-semibold text-sky-500"
              animate={
                prefersReducedMotion
                  ? undefined
                  : { rotate: [0, -1, 1, 0], scale: [1, 1.015, 1] }
              }
              transition={
                prefersReducedMotion
                  ? undefined
                  : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
              }
            >
              <span className="material-symbols-outlined"
                style={{ fontVariationSettings: "'FILL' 1", fontSize: '14px' }}>
                volunteer_activism
              </span>
              {t("earlySupporterBadge")}
            </motion.span>
            <p className="max-w-xs text-center text-xs text-muted-foreground">
              {t("earlySupporterExplanation")}
            </p>
          </div>
        </div>
      </motion.section>

      {/* Estadísticas: % aciertos, Adivinadas, Completadas, Intentos avg, Racha actual, Racha máx. */}
      <motion.section
        className="grid grid-cols-3 gap-2"
        variants={statsGridVariants}
      >
        {statCards.map((card) => (
          <motion.div key={card.icon} variants={statItemVariants}>
            <StatBlock {...card} />
          </motion.div>
        ))}
      </motion.section>

      {/* Ajustes */}
      <motion.section className="space-y-4" variants={sectionVariants}>
        {/* App Settings */}
        <motion.div variants={sectionVariants}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("settings.appSettings")}
          </p>
          <div className="overflow-hidden rounded-2xl bg-card">
            {/* Tema */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="material-symbols-outlined text-xl text-brand"
                style={{ fontVariationSettings: "'FILL' 1" }}>
                contrast
              </span>
              <span className="flex-1 text-sm font-medium">{t("theme.label")}</span>
              <div className="flex gap-1 rounded-full bg-muted p-1">
                {(["light", "dark", "system"] as const).map((th) => (
                  <button
                    key={th}
                    onClick={() => setTheme(th)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium transition-all",
                      mounted && theme === th
                        ? "bg-brand text-primary-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {t(`theme.${th}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mx-4 h-px bg-border" />

            {/* Idioma */}
            <LanguageSelector />

            <div className="mx-4 h-px bg-border" />

            {/* Notificaciones */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="material-symbols-outlined text-xl text-brand">notifications</span>
              <span className="flex-1 text-sm font-medium">{t("settings.notifications")}</span>
              <ToggleSwitch defaultChecked />
            </div>
          </div>
        </motion.div>

        {/* Account */}
        <motion.div variants={sectionVariants}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("settings.account")}
          </p>
          <div className="overflow-hidden rounded-2xl bg-card">
            {profile.role === "admin" && (
              <>
                <Link
                  href="/admin"
                  className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50"
                >
                  <span
                    className="material-symbols-outlined text-xl text-brand"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    admin_panel_settings
                  </span>
                  <span className="flex-1 text-left text-sm font-medium">
                    Panel de administración
                  </span>
                  <span className="material-symbols-outlined text-muted-foreground">
                    chevron_right
                  </span>
                </Link>
                <div className="mx-4 h-px bg-border" />
              </>
            )}
            <Link
              href="/profile/edit"
              className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50"
            >
              <span className="material-symbols-outlined text-xl text-muted-foreground">manage_accounts</span>
              <span className="flex-1 text-left text-sm font-medium">{t("settings.editProfile")}</span>
              <span className="material-symbols-outlined text-muted-foreground">chevron_right</span>
            </Link>
            <div className="mx-4 h-px bg-border" />
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-destructive transition-colors hover:bg-destructive/5"
            >
              <span className="material-symbols-outlined text-xl">logout</span>
              <span className="flex-1 text-left text-sm font-medium">{t("settings.logOut")}</span>
            </button>
          </div>
        </motion.div>
      </motion.section>
    </motion.div>
  );
}

function StatBlock({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  suffix,
}: {
  icon: string;
  iconBg: string;
  iconColor: string;
  value: number | string;
  label: string;
  suffix?: string;
}) {
  const displayValue =
    typeof value === "number"
      ? suffix
        ? `${value.toLocaleString()} ${suffix}`
        : value.toLocaleString()
      : value;
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-3 text-center">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-full", iconBg)}>
        <span
          className={cn("material-symbols-outlined text-xl", iconColor)}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
      </div>
      <p className="text-xl font-bold tabular-nums">{displayValue}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ToggleSwitch({ defaultChecked = false }: { defaultChecked?: boolean }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input type="checkbox" className="peer sr-only" defaultChecked={defaultChecked} />
      <div className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-brand peer-focus:ring-2 peer-focus:ring-brand/30" />
      <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5" />
    </label>
  );
}
