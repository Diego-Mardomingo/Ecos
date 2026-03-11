"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";
import { getMsUntilNext16hMadrid } from "@/lib/date-utils";
import { useGameProgressStore, type GameProgress } from "@/lib/store/gameProgressStore";
import { useHomeData } from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Colores para días anteriores en orden: rojo, azul, verde (bucle) */
const PREVIOUS_DAY_COLORS = [
  "hsl(0, 55%, 40%)",   /* rojo */
  "hsl(200, 50%, 40%)", /* azul */
  "hsl(140, 45%, 35%)", /* verde */
] as const;

function previousDayColor(gameNumber: number): string {
  return PREVIOUS_DAY_COLORS[(gameNumber - 1) % 3];
}

interface Props {
  initialData?: {
    todaysGame: import("@/lib/queries/games").GameWithSong | null;
    userStats: import("@/lib/queries/users").UserStats | null;
    userId: string | null;
    previousDays: PreviousDayGame[];
    inProgressByGameId?: Record<string, import("@/lib/hooks/queries").InProgressProgress>;
  };
}

export function HomeClient({ initialData }: Props) {
  const router = useRouter();
  const { data, isLoading } = useHomeData(initialData);
  const todaysGame = data?.todaysGame ?? null;
  const userStats = data?.userStats ?? null;
  const userId = data?.userId ?? null;
  const previousDays = data?.previousDays ?? [];
  const inProgressByGameId = data?.inProgressByGameId ?? {};

  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;
  const { byGameId, saveProgress } = useGameProgressStore();

  // Sincronizar progreso en curso del servidor al store (usuarios autenticados)
  useEffect(() => {
    if (!userId || Object.keys(inProgressByGameId).length === 0) return;
    for (const prog of Object.values(inProgressByGameId)) {
      const full: GameProgress = {
        ...prog,
        played: false,
        won: false,
        score: null,
      };
      saveProgress(full);
    }
  }, [userId, inProgressByGameId, saveProgress]);

  // Hoy: servidor (inProgressByGameId) tiene prioridad para usuarios autenticados
  const todaysLocalOrServer = todaysGame
    ? (userId && inProgressByGameId[todaysGame.id]
        ? inProgressByGameId[todaysGame.id]
        : byGameId[todaysGame.id])
    : undefined;
  const todaysProgress = todaysLocalOrServer;
  const todaysCompleted = todaysProgress && (todaysProgress.phase === "won" || todaysProgress.phase === "lost");
  const todaysDisplayCover = todaysCompleted ? (todaysProgress?.cover_url ?? todaysGame?.ecos_songs.cover_url) : "";
  const todaysInProgress = todaysProgress?.phase === "playing" && (todaysProgress?.guesses?.length ?? 0) > 0;
  const todaysGuesses = todaysProgress?.guesses ?? [];

  const handleShareHome = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const url = locale === "en" ? `${base}/en` : `${base}/`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "ECOS",
          text: "Adivina la canción del día - ECOS",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* ignore */
      }
    }
  };

  if (isLoading && !data) {
    return (
      <div className="flex min-h-full flex-col gap-5 px-4 pb-6 pt-safe">
        <div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
        <div className="aspect-[4/3] animate-pulse rounded-2xl bg-muted" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 pb-6 pt-safe">
      {/* Header */}
      <header className="sticky top-0 z-30 -mx-4 flex items-center justify-between px-4 py-3 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}>
        <div className="flex items-center gap-2">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand/15 ring-1 ring-brand/30">
            <Image
              src="/ecos_icon_v2_192.png"
              alt=""
              width={36}
              height={36}
              className="object-contain"
              sizes="36px"
            />
          </div>
          <span className="text-lg font-bold tracking-tight">{tc("appName")}</span>
          <span
            className="material-symbols-outlined text-xl text-brand"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            music_note
          </span>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80">
              <span className="material-symbols-outlined text-xl">info</span>
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("aboutTitle")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{t("aboutDescription")}</p>
            <h4 className="mt-4 font-semibold">{t("howToPlayTitle")}</h4>
            <p className="text-sm text-muted-foreground">{t("howToPlaySteps")}</p>
          </DialogContent>
        </Dialog>
      </header>

      {/* Today's Challenge Hero */}
      <section>
        <div className="mb-3 flex justify-center">
          <Countdown t={t} />
        </div>

        <motion.div
          role="button"
          tabIndex={0}
          whileTap={{ scale: 0.99 }}
          onClick={() => router.push("/play")}
          onKeyDown={(e) => e.key === "Enter" && router.push("/play")}
          className="relative cursor-pointer overflow-hidden rounded-2xl"
          style={{ aspectRatio: "4/3" }}
        >
          {/* Fondo fijo de la tarjeta - gradiente verde con profundidad */}
          <div
            className="h-full w-full"
            style={{
              background: "linear-gradient(165deg, color-mix(in srgb, #2bee79 35%, #0f1412) 0%, color-mix(in srgb, #2bee79 22%, #0a0f0c) 40%, color-mix(in srgb, #2bee79 12%, #050808) 100%)",
            }}
          />

          {/* Overlay gradiente */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

          {/* Badge de estado: sin jugar | en proceso | acertado | fallido */}
          <TodaysCardBadge
            todaysCompleted={todaysCompleted}
            todaysInProgress={todaysInProgress}
            todaysWon={todaysProgress?.phase === "won"}
            t={t}
          />

          {/* Badge jugadores */}
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md">
            <span className="material-symbols-outlined text-sm text-brand"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              whatshot
            </span>
            12k {t("playing")}
          </div>

          {/* Waveform decorativa animada (valores estables para evitar re-renders) */}
          <WaveformBars />

          {/* Info y acciones */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <p className="mb-1 text-xs font-medium text-white/70">
              {format(new Date(), "d MMM", { locale: dateFnsLocale })}
              {todaysGame?.game_number != null && (
                <> <span className="text-white/50">|</span> <span className="tabular-nums text-white/50">#{todaysGame.game_number}</span></>
              )}
            </p>
            <h3 className="mb-2 text-2xl font-bold text-white">{t("guessTheSong")}</h3>
            {todaysInProgress && (
              <div className="mb-3 flex items-center gap-1.5">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        i < todaysGuesses.length
                          ? "bg-destructive"
                          : i === todaysGuesses.length
                          ? "bg-white/80"
                          : "bg-white/40"
                      )}
                    />
                ))}
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-[#0a2015]">
                <span className="material-symbols-outlined text-lg"
                  style={{ fontVariationSettings: "'FILL' 1" }}>
                  play_arrow
                </span>
                {t("playNow")}
              </div>
              <button
                type="button"
                onClick={handleShareHome}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-all active:scale-95"
              >
                <span className="material-symbols-outlined text-xl">share</span>
              </button>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Stats rápidas */}
      {userId ? (
        <section className="grid grid-cols-2 gap-3">
          <StatCard
            label={t("currentStreak")}
            value={`${userStats?.streak ?? 0}`}
            suffix={tc("days")}
            icon="local_fire_department"
            iconColor="text-orange-400"
          />
          <StatCard
            label={t("globalRank")}
            value={userStats?.global_rank ? `#${userStats.global_rank}` : "—"}
            icon="emoji_events"
            iconColor="text-brand"
          />
        </section>
      ) : (
        /* Invitado: CTA motivacional para registrarse */
        <section>
          <Link
            href="/login"
            className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 transition-colors active:bg-card/70"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand/15">
              <span
                className="material-symbols-outlined text-xl text-brand"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                person_add
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Únete al ranking global</p>
              <p className="text-xs text-muted-foreground">
                Inicia sesión para guardar tu racha y competir
              </p>
            </div>
            <span className="material-symbols-outlined text-brand">chevron_right</span>
          </Link>
        </section>
      )}

      {/* Días anteriores */}
      <PreviousDaysSection
        previousDays={previousDays}
        userId={userId}
        inProgressByGameId={inProgressByGameId}
      />
    </div>
  );
}

function TodaysCardBadge({
  todaysCompleted,
  todaysInProgress,
  todaysWon,
  t,
}: {
  todaysCompleted: boolean;
  todaysInProgress: boolean;
  todaysWon?: boolean;
  t: (key: string) => string;
}) {
  const baseClass = "absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur-md";

  if (todaysCompleted) {
    const isWon = todaysWon === true;
    return (
      <div
        className={cn(
          baseClass,
          isWon
            ? "bg-brand/15 text-brand"
            : "bg-destructive/15 text-destructive"
        )}
      >
        <span
          className={cn(
            "material-symbols-outlined text-sm",
            isWon ? "text-brand" : "text-destructive"
          )}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {isWon ? "check_circle" : "cancel"}
        </span>
        {isWon ? t("badgeWon") : t("badgeLost")}
      </div>
    );
  }

  if (todaysInProgress) {
    return (
      <div className={cn(baseClass, "bg-teal-500/15 text-teal-600 dark:text-teal-400")}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />
        {t("badgeInProgress")}
      </div>
    );
  }

  return (
    <div className={cn(baseClass, "bg-blue-500/15 text-blue-600 dark:text-blue-400")}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      {t("badgeNotPlayed")}
    </div>
  );
}

function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function Countdown({ t }: { t: (key: string) => string }) {
  const [mounted, setMounted] = useState(false);
  const [ms, setMs] = useState(0);

  useEffect(() => {
    setMounted(true);
    setMs(getMsUntilNext16hMadrid());
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const tick = () => setMs(getMsUntilNext16hMadrid());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mounted]);

  return (
    <span className="text-xs font-medium text-muted-foreground tabular-nums">
      {t("nextSongIn")} {mounted ? formatCountdown(ms) : "—"}
    </span>
  );
}

function WaveformBars() {
  const bars = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        key: i,
        heightA: 8 + ((i * 7) % 25),
        heightB: 8 + ((i * 11 + 13) % 25),
        duration: 0.6 + (i % 10) * 0.08,
        delay: i * 0.03,
      })),
    []
  );
  return (
    <div className="absolute left-0 right-0 top-1/3 flex items-center justify-center gap-[3px] px-8 opacity-60">
      {bars.map(({ key, heightA, heightB, duration, delay }) => (
        <motion.div
          key={key}
          className="w-[3px] rounded-full bg-brand"
          animate={{ height: [`${heightA}px`, `${heightB}px`] }}
          transition={{
            duration,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut",
            delay,
          }}
        />
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon,
  iconColor,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: string;
  iconColor: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-4">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-bold">{value}</span>
        {suffix && (
          <span className="mb-0.5 text-sm text-muted-foreground">{suffix}</span>
        )}
      </div>
    </div>
  );
}

function PreviousDaysSection({
  previousDays,
  userId,
  inProgressByGameId = {},
}: {
  previousDays: PreviousDayGame[];
  userId: string | null;
  inProgressByGameId?: Record<string, import("@/lib/hooks/queries").InProgressProgress>;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;
  const byGameId = useGameProgressStore((s) => s.byGameId);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterMonth, setFilterMonth] = useState<number | null>(null);
  const [filterYear, setFilterYear] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const filteredDays = useMemo(() => {
    if (filterMonth === null && filterYear === null) return previousDays;
    return previousDays.filter((day) => {
      const [y, m] = day.date.split("-").map(Number);
      if (filterMonth !== null && m !== filterMonth + 1) return false;
      if (filterYear !== null && y !== filterYear) return false;
      return true;
    });
  }, [previousDays, filterMonth, filterYear]);

  const sortedDays = useMemo(() => {
    const sorted = [...filteredDays].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredDays, sortOrder]);

  const availableMonthYearPairs = useMemo(() => {
    const seen = new Set<string>();
    return previousDays
      .map((d) => {
        const [y, m] = d.date.split("-").map(Number);
        return { month: m - 1, year: y, key: `${y}-${m}` };
      })
      .filter(({ key }) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month));
  }, [previousDays]);

  const availableYears = useMemo(
    () => [...new Set(availableMonthYearPairs.map((p) => p.year))].sort((a, b) => b - a),
    [availableMonthYearPairs]
  );

  const availableMonthsForFilter = useMemo(() => {
    if (filterYear !== null) {
      return availableMonthYearPairs
        .filter((p) => p.year === filterYear)
        .map((p) => p.month)
        .sort((a, b) => a - b);
    }
    return [...new Set(availableMonthYearPairs.map((p) => p.month))].sort((a, b) => a - b);
  }, [availableMonthYearPairs, filterYear]);

  const monthNamesFull =
    locale === "es"
      ? ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
      : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("previousDays")}</h2>
        <div className="flex items-center gap-2">
          <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors",
                viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={t("viewList")}
            >
              <span className="material-symbols-outlined text-lg">format_list_bulleted</span>
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors",
                viewMode === "grid" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={t("viewGrid")}
            >
              <span className="material-symbols-outlined text-lg">grid_view</span>
            </button>
          </div>
          <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/30">
              <button
                onClick={() => setFilterOpen(true)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50",
                  filterMonth !== null || filterYear !== null ? "text-brand" : ""
                )}
                aria-label={t("filterByDate")}
              >
                <span className="material-symbols-outlined text-lg">filter_list</span>
              </button>
            </div>
          <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle>{t("filterByDate")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t("filterYear")}</label>
                  <select
                    value={filterYear ?? ""}
                    onChange={(e) => {
                      const val = e.target.value === "" ? null : Number(e.target.value);
                      setFilterYear(val);
                      if (val !== null && filterMonth !== null) {
                        const valid = availableMonthYearPairs.some((p) => p.year === val && p.month === filterMonth);
                        if (!valid) setFilterMonth(null);
                      }
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{t("filterAll")}</option>
                    {availableYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t("filterMonth")}</label>
                  <select
                    value={filterMonth ?? ""}
                    onChange={(e) => setFilterMonth(e.target.value === "" ? null : Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{t("filterAll")}</option>
                    {availableMonthsForFilter.map((i) => (
                      <option key={i} value={i}>{monthNamesFull[i]}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => {
                    setFilterMonth(null);
                    setFilterYear(null);
                    setFilterOpen(false);
                  }}
                  className="w-full rounded-lg border border-border bg-muted/50 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  {t("resetFilter")}
                </button>
              </div>
            </DialogContent>
          </Dialog>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/30">
            <button
              onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              aria-label={sortOrder === "desc" ? t("sortDesc") : t("sortAsc")}
            >
              <span
                className={cn("material-symbols-outlined text-lg", sortOrder === "asc" && "rotate-180")}
              >
                arrow_downward
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className={cn("gap-2", viewMode === "list" ? "flex flex-col" : "grid grid-cols-5 gap-2")}>
        {sortedDays.length === 0 ? (
          <p className={cn("rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground", viewMode === "grid" && "col-span-5")}>
            {previousDays.length === 0 ? "Aún no hay días anteriores" : t("noGamesInPeriod")}
          </p>
        ) : (
          sortedDays.map((day) => {
            // Usuarios autenticados: servidor (day, inProgressByGameId) es fuente de verdad.
            // Invitados: gameProgressStore.
            const serverInProgress = userId ? inProgressByGameId[day.id] : undefined;
            const localProgress = serverInProgress ?? byGameId[day.id];
            const played = userId ? day.played : !!localProgress;
            const serverHasResult = userId && day.played && day.score != null;
            const displayTitle = played ? (localProgress?.title ?? day.title) : "";
            const displayCover = played ? (localProgress?.cover_url ?? day.cover_url) : "";
            const displayScore = played ? (serverHasResult ? day.score : (localProgress?.score ?? day.score)) : null;
            const won = played && (serverHasResult ? day.won : (localProgress?.won ?? day.won));
            const completed = played && displayScore !== null;
            const inProgress =
              !serverHasResult &&
              localProgress?.phase === "playing" &&
              (localProgress?.guesses?.length ?? 0) > 0;
            const guesses = localProgress?.guesses ?? [];
            const maxAttempts = 6;

            return (
              <Link key={day.id} href={`/play/${day.id}`}>
                <motion.div
                  whileTap={{ scale: 0.99 }}
                  className={cn(
                    "border-0 transition-colors active:opacity-90",
                    viewMode === "list"
                      ? "flex items-center gap-3 rounded-2xl bg-card p-3 active:bg-card/70"
                      : "relative aspect-square overflow-hidden rounded-xl bg-card"
                  )}
                >
                  {viewMode === "grid" ? (
                    <>
                      <div className="absolute inset-0">
                        {played && displayCover ? (
                          <Image src={displayCover} alt={displayTitle || "Album"} fill className="object-cover" />
                        ) : (
                          <div
                            className="h-full w-full"
                            style={{ backgroundColor: previousDayColor(day.game_number) }}
                          />
                        )}
                      </div>
                      {played && completed && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span
                            className={cn(
                              "material-symbols-outlined text-2xl drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] leading-none",
                              won ? "text-brand" : "text-destructive"
                            )}
                            style={{ fontVariationSettings: "'FILL' 1" }}
                          >
                            {won ? "check_circle" : "cancel"}
                          </span>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                        <span className="text-[10px] font-medium text-white">#{day.game_number}</span>
                      </div>
                    </>
                  ) : (
                    <>
                  {/* Miniatura: carátula real si jugado, placeholder con color estable si no */}
                  <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl">
                    {played && displayCover ? (
                      <Image src={displayCover} alt={displayTitle || "Album"} fill className="object-cover" />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ backgroundColor: previousDayColor(day.game_number) }}
                      >
                        <span
                          className="material-symbols-outlined text-2xl text-white/90"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          play_arrow
                        </span>
                      </div>
                    )}
                    {played && completed && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span
                          className={cn(
                            "material-symbols-outlined text-xl drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] leading-none",
                            won ? "text-brand" : "text-destructive"
                          )}
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          {won ? "check_circle" : "cancel"}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="mb-0.5 text-xs text-muted-foreground">
                      {format(parseISO(day.date), "d MMM", { locale: dateFnsLocale })}
                      <span className="text-muted-foreground/60"> | </span>
                      <span className="tabular-nums text-muted-foreground/70">#{day.game_number}</span>
                    </p>
                    <p className="truncate font-semibold">
                      {completed ? displayTitle || "—" : t("guessTheSong")}
                    </p>
                    {completed && displayScore !== null ? (
                      <p className="text-xs font-medium text-brand">
                        {t("score")}: {displayScore.toLocaleString(locale === "es" ? "es" : "en-US")} {tc("points")}
                      </p>
                    ) : inProgress ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        {Array.from({ length: maxAttempts }).map((_, i) => (
                            <div
                              key={i}
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                i < guesses.length
                                  ? "bg-destructive"
                                  : i === guesses.length
                                  ? "bg-muted-foreground/70"
                                  : "bg-muted-foreground/45"
                              )}
                            />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("notPlayedYet")}</p>
                    )}
                  </div>

                  <span className="material-symbols-outlined text-muted-foreground">
                    {played && completed ? "chevron_right" : "play_circle"}
                  </span>
                    </>
                  )}
                </motion.div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
