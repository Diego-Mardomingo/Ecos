"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import Image from "next/image";
import { format } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile } from "@/lib/hooks/queries";
import type { UserStats } from "@/lib/queries/users";
import { LanguageSelector } from "@/components/profile/LanguageSelector";
import { cn } from "@/lib/utils";

interface Profile {
  id: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
  email: string;
  role?: string | null;
}

interface Props {
  initialData?: {
    profile: Profile;
    stats: UserStats | null;
  };
}

export function ProfileClient({ initialData }: Props) {
  const { data, isLoading } = useProfile(initialData);
  const profile = data?.profile ?? {
    id: "",
    display_name: "",
    avatar_url: "",
    created_at: "",
    email: "",
    role: null,
  };
  const stats = data?.stats ?? null;

  const t = useTranslations("profile");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const locale = useLocale();

  // Evitar hydration mismatch: el tema se lee de localStorage solo en el cliente
  useEffect(() => setMounted(true), []);
  const dateFnsLocale = locale === "es" ? es : enUS;

  if (isLoading && !data) {
    return (
      <div className="flex min-h-full flex-col gap-5 px-4 pb-28">
        <div className="h-8 animate-pulse rounded bg-muted" />
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="h-24 w-24 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        </div>
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

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 pb-28">
      {/* Header */}
      <header className="py-3 text-center text-base font-bold">{t("title")}</header>

      {/* Avatar + info */}
      <section className="flex flex-col items-center gap-3 py-4">
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
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-3 py-0.5 text-xs font-semibold text-sky-500">
              <span className="material-symbols-outlined"
                style={{ fontVariationSettings: "'FILL' 1", fontSize: '14px' }}>
                volunteer_activism
              </span>
              {t("earlySupporterBadge")}
            </span>
            <p className="max-w-xs text-center text-xs text-muted-foreground">
              {t("earlySupporterExplanation")}
            </p>
          </div>
        </div>
      </section>

      {/* Estadísticas */}
      <section className="grid grid-cols-3 gap-2">
        <StatBlock
          icon="check_circle"
          iconBg="bg-blue-500/15"
          iconColor="text-blue-400"
          value={stats?.games_won ?? 0}
          label={t("stats.guessed")}
        />
        <StatBlock
          icon="local_fire_department"
          iconBg="bg-orange-500/15"
          iconColor="text-orange-400"
          value={stats?.max_streak ?? stats?.streak ?? 0}
          label={t("stats.maxStreak")}
        />
        <StatBlock
          icon="emoji_events"
          iconBg="bg-brand/15"
          iconColor="text-brand"
          value={stats?.total_points ?? 0}
          label={t("stats.points")}
        />
      </section>

      {/* Ajustes */}
      <section className="space-y-4">
        {/* App Settings */}
        <div>
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
                        ? "bg-brand text-[#0a2015]"
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
        </div>

        {/* Account */}
        <div>
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
        </div>
      </section>
    </div>
  );
}

function StatBlock({
  icon,
  iconBg,
  iconColor,
  value,
  label,
}: {
  icon: string;
  iconBg: string;
  iconColor: string;
  value: number;
  label: string;
}) {
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
      <p className="text-xl font-bold">{value.toLocaleString()}</p>
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
