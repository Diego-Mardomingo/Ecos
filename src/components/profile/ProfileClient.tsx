"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import Image from "next/image";
import { format } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { UserStats } from "@/lib/queries/users";
import { cn } from "@/lib/utils";

interface Profile {
  id: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
  email: string;
}

interface Props {
  profile: Profile;
  stats: UserStats | null;
}

const ACHIEVEMENTS = [
  { id: "perfect_week", title: "Perfect Week", icon: "star", gradient: "from-slate-700 to-slate-900", earned: true },
  { id: "genre_master", title: "Genre Master", icon: "music_note", gradient: "from-indigo-600 to-indigo-900", earned: true },
  { id: "streak_30", title: "30 Day Streak", icon: "local_fire_department", gradient: "from-orange-500 to-red-700", earned: false },
  { id: "top_10", title: "Top 10 Global", icon: "emoji_events", gradient: "from-brand/80 to-green-900", earned: false },
];

export function ProfileClient({ profile, stats }: Props) {
  const t = useTranslations("profile");
  const { theme, setTheme } = useTheme();
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const memberSince = profile.created_at
    ? format(new Date(profile.created_at), "MMMM yyyy", { locale: dateFnsLocale })
    : "";

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 pb-28 pt-safe">
      {/* Header */}
      <header className="py-3 text-center text-base font-bold">{t("title")}</header>

      {/* Avatar + info */}
      <section className="flex flex-col items-center gap-3 py-4">
        <div className="relative">
          <Avatar className="h-24 w-24 ring-2 ring-brand/40">
            <AvatarImage src={profile.avatar_url} />
            <AvatarFallback className="bg-secondary text-2xl font-bold">
              {profile.display_name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <button className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand shadow-md">
            <span className="material-symbols-outlined text-base text-[#0a2015]"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              edit
            </span>
          </button>
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold">{profile.display_name}</h2>
          {memberSince && (
            <p className="text-sm text-muted-foreground">
              {t("memberSince")} {memberSince}
            </p>
          )}
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand/15 px-3 py-0.5 text-xs font-semibold text-brand">
            <span className="material-symbols-outlined text-xs"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              verified
            </span>
            Pro Player
          </span>
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
          value={stats?.streak ?? 0}
          label={t("stats.streak")}
        />
        <StatBlock
          icon="emoji_events"
          iconBg="bg-brand/15"
          iconColor="text-brand"
          value={stats?.total_points ?? 0}
          label={t("stats.points")}
        />
      </section>

      {/* Logros */}
      <section>
        <h3 className="mb-3 font-semibold">{t("achievements")}</h3>
        <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
          {ACHIEVEMENTS.map((a) => (
            <div
              key={a.id}
              className={cn(
                "relative min-w-[160px] overflow-hidden rounded-2xl bg-gradient-to-br p-4",
                a.gradient,
                !a.earned && "opacity-50 grayscale"
              )}
            >
              <span
                className="material-symbols-outlined absolute -right-2 -top-2 text-6xl opacity-10 text-white"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {a.icon}
              </span>
              <span
                className="material-symbols-outlined text-2xl text-white"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {a.icon}
              </span>
              <p className="mt-2 text-sm font-bold text-white">{a.title}</p>
            </div>
          ))}
        </div>
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
                      theme === th
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
            <button className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50">
              <span className="material-symbols-outlined text-xl text-brand">language</span>
              <span className="flex-1 text-left text-sm font-medium">{t("settings.language")}</span>
              <span className="text-sm text-muted-foreground">{locale === "es" ? "Español" : "English"}</span>
              <span className="material-symbols-outlined text-muted-foreground">chevron_right</span>
            </button>

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
            <button className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50">
              <span className="material-symbols-outlined text-xl text-muted-foreground">manage_accounts</span>
              <span className="flex-1 text-left text-sm font-medium">{t("settings.editProfile")}</span>
              <span className="material-symbols-outlined text-muted-foreground">chevron_right</span>
            </button>
            <div className="mx-4 h-px bg-border" />
            <button className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50">
              <span className="material-symbols-outlined text-xl text-muted-foreground">policy</span>
              <span className="flex-1 text-left text-sm font-medium">{t("settings.privacyPolicy")}</span>
              <span className="material-symbols-outlined text-muted-foreground">chevron_right</span>
            </button>
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
      <div className="h-6 w-11 rounded-full bg-muted transition-all peer-checked:bg-brand peer-focus:ring-2 peer-focus:ring-brand/30">
        <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </div>
    </label>
  );
}
