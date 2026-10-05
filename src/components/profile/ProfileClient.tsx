"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { motion, type Variants } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile } from "@/lib/hooks/queries";
import { useNotifications } from "@/lib/hooks/useNotifications";
import type { UserStats } from "@/lib/queries/users";
import { LanguageSelector } from "@/components/profile/LanguageSelector";
import { ThemeSelector } from "@/components/profile/ThemeSelector";
import { SettingsGroup, SettingsRow } from "@/components/profile/SettingsRow";
import { cn } from "@/lib/utils";
import { ProfileSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { HeaderIconLink, PageHeader } from "@/components/ui/page-header";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { BellOff, Loader2 } from "lucide-react";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";

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
    notifications?: {
      enabled: boolean;
      modalDismissCount: number;
    };
  };
}

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

/** Perímetro del anillo de % de aciertos (2πr con r=42). */
const RING_CIRCUMFERENCE = 263.89;

export function ProfileClient({ initialData }: Props) {
  const profileUserId = initialData?.profile.id ?? null;
  const { data, isLoading, coreError, refetch } = useProfile(profileUserId, initialData);
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
  const tn = useTranslations("notifications");
  const notifications = useNotifications({
    enabled: true,
    initialStatus: initialData?.notifications,
  });
  const { dateFnsLocale, formatNumber } = useAppFormatters();

  const handleToggleNotifications = async (next: boolean) => {
    if (next) {
      const success = await notifications.enable();
      if (success) {
        toast.success(tn("enabledToast"));
      } else if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        toast.error(tn("permissionDenied"));
      }
    } else {
      await notifications.disable();
      toast(tn("disabledToast"), {
        icon: <BellOff className="size-4 text-destructive" aria-hidden />,
        classNames: {
          toast:
            "border-destructive/45 bg-destructive/12 text-foreground dark:bg-destructive/20 [&_[data-icon]]:text-destructive",
        },
      });
    }
  };

  if (isLoading && !data) {
    return <ProfileSkeleton />;
  }

  if (coreError && !data) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 pb-28 pt-12">
        <span className="flex size-16 items-center justify-center rounded-full bg-muted">
          <span aria-hidden className="material-symbols-outlined text-3xl text-muted-foreground">
            cloud_off
          </span>
        </span>
        <p className="text-center text-sm text-muted-foreground">{tc("error")}</p>
        <Button type="button" variant="secondary" className="rounded-full" onClick={() => void refetch()}>
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

  const gamesPlayed = stats?.games_played ?? 0;
  const gamesWon = stats?.games_won ?? 0;
  const hitRate = gamesPlayed ? Math.round((gamesWon / gamesPlayed) * 100) : 0;
  const avgAttempts = typeof stats?.avg_guesses === "number" ? stats.avg_guesses : 0;
  const streak = stats?.streak ?? 0;
  const maxStreak = stats?.max_streak ?? 0;
  const formatOneDecimal = (n: number) => (n / 10).toFixed(1);

  return (
    <div className="flex flex-col px-4 pb-6">
      <PageHeader
        title={t("title")}
        action={<HeaderIconLink href="/profile/edit" icon="edit" label={t("settings.editProfile")} />}
      />

      <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-5">
        {/* Tarjeta de identidad */}
        <motion.section
          variants={rise}
          className="relative isolate overflow-hidden rounded-[28px] border border-border bg-card px-5 pb-5 pt-6 text-center"
        >
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-28 overflow-hidden">
            <div className="ecos-drift-a absolute -left-10 -top-16 size-48 rounded-full bg-brand/25 blur-3xl" />
            <div className="ecos-drift-b absolute -right-10 -top-10 size-40 rounded-full bg-sky-400/20 blur-3xl" />
          </div>
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.1 }}
            className="mx-auto w-fit rounded-full bg-gradient-to-br from-brand via-sky-400 to-violet-400 p-[3px]"
          >
            <span className="block rounded-full bg-card p-[3px]">
              <Avatar className="size-24">
                <AvatarImage src={profile.avatar_url} />
                <AvatarFallback className="bg-muted text-2xl font-bold">
                  {profile.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </span>
          </motion.div>
          <h2 className="mt-3 truncate text-2xl font-bold tracking-tight">{profile.display_name}</h2>
          {memberSince && (
            <p className="text-sm text-muted-foreground">
              {t("memberSince")} {memberSince}
            </p>
          )}
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-sky-500/12 px-3 py-1 text-xs font-semibold text-sky-600 ring-1 ring-sky-500/25 dark:text-sky-400">
            <span aria-hidden className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
              volunteer_activism
            </span>
            {t("earlySupporterBadge")}
          </div>
          <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {t("earlySupporterExplanation")}
          </p>
        </motion.section>

        {/* Aciertos: anillo + desglose */}
        <motion.section variants={rise} className="flex items-center gap-5 rounded-3xl border border-border bg-card p-4">
          <div className="relative size-24 shrink-0">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="9" className="text-foreground/10" />
              <motion.circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="9"
                strokeLinecap="round"
                className="text-brand"
                strokeDasharray={RING_CIRCUMFERENCE}
                initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
                animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - hitRate / 100) }}
                transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold leading-none tabular-nums">
                <AnimatedNumber value={hitRate} format={String} delay={0.3} duration={1.1} />
                <span className="text-sm">%</span>
              </span>
              <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">{t("stats.hitRate")}</span>
            </div>
          </div>
          <dl className="grid min-w-0 flex-1 gap-2.5">
            <StatLine label={t("stats.guessed")} icon="check_circle" iconClass="text-brand">
              <AnimatedNumber value={gamesWon} format={formatNumber} delay={0.35} />
            </StatLine>
            <StatLine label={t("stats.completed")} icon="flag" iconClass="text-violet-500">
              <AnimatedNumber value={gamesPlayed} format={formatNumber} delay={0.4} />
            </StatLine>
            <StatLine label={t("stats.avgAttempts")} icon="analytics" iconClass="text-amber-500">
              {/* En décimas para poder animarlo como entero. */}
              <AnimatedNumber value={Math.round(avgAttempts * 10)} format={formatOneDecimal} delay={0.45} />
            </StatLine>
          </dl>
        </motion.section>

        {/* Rachas */}
        <motion.section variants={rise} className="grid grid-cols-2 gap-3">
          <StreakTile
            icon="local_fire_department"
            label={t("stats.currentStreak")}
            value={streak}
            suffix={tc("days")}
            accent="from-orange-500/20 text-orange-500"
            flicker={streak > 0}
          />
          <StreakTile
            icon="whatshot"
            label={t("stats.maxStreak")}
            value={maxStreak}
            suffix={tc("days")}
            accent="from-rose-500/20 text-rose-500"
          />
        </motion.section>

        {/* Ajustes */}
        <motion.div variants={rise}>
          <SettingsGroup title={t("settings.appSettings")}>
            <ThemeSelector />
            <LanguageSelector />
            {notifications.isSupported && (
              <SettingsRow icon="notifications" iconClass="bg-amber-500/15 text-amber-500" label={t("settings.notifications")}>
                <div className="flex items-center gap-2">
                  {notifications.isLoading ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                  ) : null}
                  <ToggleSwitch
                    label={t("settings.notifications")}
                    checked={notifications.isEnabled}
                    disabled={notifications.isLoading}
                    onCheckedChange={(next) => void handleToggleNotifications(next)}
                  />
                </div>
              </SettingsRow>
            )}
          </SettingsGroup>
        </motion.div>

        <motion.div variants={rise}>
          <SettingsGroup title={t("settings.account")}>
            {profile.role === "admin" && (
              <SettingsLink href="/admin" icon="admin_panel_settings" iconClass="bg-violet-500/15 text-violet-500" label="Panel de administración" />
            )}
            <SettingsLink href="/profile/edit" icon="manage_accounts" iconClass="bg-muted text-foreground" label={t("settings.editProfile")} />
            <button
              type="button"
              onClick={handleSignOut}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-destructive transition-colors hover:bg-destructive/5 active:bg-destructive/10"
            >
              {/* Mismo aspecto que `SettingsRow`, pero con `span`: un `div` no puede ir dentro de un botón. */}
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/12">
                <span aria-hidden className="material-symbols-outlined text-xl">
                  logout
                </span>
              </span>
              <span className="text-sm font-medium">{t("settings.logOut")}</span>
            </button>
          </SettingsGroup>
        </motion.div>
      </motion.div>
    </div>
  );
}

function StatLine({
  label,
  icon,
  iconClass,
  children,
}: {
  label: string;
  icon: string;
  iconClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className={cn("material-symbols-outlined text-lg", iconClass)} style={{ fontVariationSettings: "'FILL' 1" }}>
        {icon}
      </span>
      <dt className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base font-bold tabular-nums">{children}</dd>
    </div>
  );
}

function StreakTile({
  icon,
  label,
  value,
  suffix,
  accent,
  flicker = false,
}: {
  icon: string;
  label: string;
  value: number;
  suffix: string;
  /** Degradado del halo y color del icono. */
  accent: string;
  /** La llama tiembla si la racha está viva. */
  flicker?: boolean;
}) {
  const { formatNumber } = useAppFormatters();
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-4">
      <div aria-hidden className={cn("absolute -right-6 -top-6 size-24 rounded-full bg-gradient-to-br to-transparent blur-xl", accent)} />
      <motion.span
        aria-hidden
        animate={flicker ? { scale: [1, 1.12, 0.96, 1.08, 1], rotate: [0, -4, 3, -2, 0] } : undefined}
        transition={flicker ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : undefined}
        className={cn("material-symbols-outlined relative block w-fit text-3xl", accent)}
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </motion.span>
      <p className="relative mt-2 text-3xl font-bold leading-none tracking-tight">
        <AnimatedNumber value={value} format={formatNumber} delay={0.4} />
        <span className="ml-1 text-sm font-medium text-muted-foreground">{suffix}</span>
      </p>
      <p className="relative mt-1 text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function SettingsLink({ href, icon, iconClass, label }: { href: string; icon: string; iconClass: string; label: string }) {
  return (
    <Link href={href} className="group flex items-center transition-colors hover:bg-muted/50 active:bg-muted">
      <SettingsRow icon={icon} iconClass={iconClass} label={label} className="w-full">
        <span aria-hidden className="material-symbols-outlined text-xl text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5">
          chevron_right
        </span>
      </SettingsRow>
    </Link>
  );
}
