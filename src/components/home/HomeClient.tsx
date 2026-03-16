"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";
import {
  getMadridDate,
  getMsUntilNextMidnightMadrid,
  getTomorrowMadridDate,
} from "@/lib/date-utils";
import { getNextStreakBonusPoints } from "@/lib/scoring";
import { useGameProgressStore, type GameProgress } from "@/lib/store/gameProgressStore";
import { useQueryClient } from "@tanstack/react-query";
import { useHomeData, queryKeys, type HomeData } from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PREVIOUS_DAYS_FILTER_STORAGE_KEY = "ecos-previous-days-filter";
const HOME_MONTHS_OPEN_STORAGE_KEY = "ecos-home-months-open";
const HOME_VIEW_MODE_STORAGE_KEY = "ecos-home-view-mode";
const HOME_SORT_ORDER_STORAGE_KEY = "ecos-home-sort-order";
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
    todaysCompletedResult?: import("@/lib/hooks/queries").TodaysCompletedResult | null;
    rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
  };
}

export function HomeClient({ initialData }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useHomeData(initialData);
  const prefetchedNextRef = useRef<HomeData | null>(null);
  const hasPrefetchedRef = useRef(false);

  const handleCountdownUnder10s = useCallback(() => {
    if (hasPrefetchedRef.current) return;
    hasPrefetchedRef.current = true;
    const effectiveDate = getTomorrowMadridDate();
    fetch(`/api/home?effectiveDate=${encodeURIComponent(effectiveDate)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: HomeData | null) => {
        if (payload) prefetchedNextRef.current = payload;
      })
      .catch(() => {});
  }, []);

  const handleCountdownZero = useCallback(() => {
    if (prefetchedNextRef.current) {
      queryClient.setQueryData(queryKeys.home, prefetchedNextRef.current);
      prefetchedNextRef.current = null;
    }
    refetch();
  }, [queryClient, refetch]);

  const todaysGame = data?.todaysGame ?? null;
  const userStats = data?.userStats ?? null;
  const userId = data?.userId ?? null;
  const previousDays = data?.previousDays ?? [];
  const inProgressByGameId = data?.inProgressByGameId ?? {};
  const todaysCompletedResult = data?.todaysCompletedResult ?? null;
  const rankingRanks = data?.rankingRanks;

  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;
  const { byGameId, saveProgress } = useGameProgressStore();

  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState<"bug" | "error" | "suggestion">("bug");
  const [reportMessage, setReportMessage] = useState("");
  const [reportEmail, setReportEmail] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

  const handleReportSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const message = reportMessage.trim();
      if (!message) return;
      setReportStatus("sending");
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: reportType,
            message,
            email: reportEmail.trim() || undefined,
          }),
        });
        if (!res.ok) throw new Error("Failed");
        setReportStatus("success");
        setReportMessage("");
        setReportEmail("");
      } catch {
        setReportStatus("error");
      }
    },
    [reportType, reportMessage, reportEmail]
  );

  const handleReportOpenChange = useCallback((open: boolean) => {
    setReportOpen(open);
    if (!open) setReportStatus("idle");
  }, []);

  // Sincronizar progreso en curso del servidor al store (solo invitados; autenticados usan inProgressByGameId directamente)
  useEffect(() => {
    if (userId || Object.keys(inProgressByGameId).length === 0) return;
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
  const todaysCompleted =
    (todaysProgress && (todaysProgress.phase === "won" || todaysProgress.phase === "lost")) || !!todaysCompletedResult;
  const todaysDisplayCover = todaysCompleted
    ? (todaysCompletedResult?.cover_url ?? todaysProgress?.cover_url ?? todaysGame?.ecos_songs.cover_url ?? "")
    : "";
  const todaysDisplayTitle = todaysCompleted
    ? (todaysCompletedResult?.title ?? todaysProgress?.title ?? todaysGame?.ecos_songs?.title ?? "")
    : "";
  const todaysDisplayArtist = todaysCompleted
    ? (todaysCompletedResult?.artist_name ?? todaysProgress?.artist_name ?? todaysGame?.ecos_songs?.artist_name ?? "")
    : "";
  const todaysDisplayScore = todaysCompleted
    ? (todaysCompletedResult?.score ?? todaysProgress?.score ?? null)
    : null;
  const todaysInProgress = todaysProgress?.phase === "playing" && (todaysProgress?.guesses?.length ?? 0) > 0;
  const todaysGuesses = todaysProgress?.guesses ?? [];
  const todaysWon = todaysCompletedResult?.won ?? todaysProgress?.phase === "won";

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
      <div className="flex min-h-full flex-col gap-5 px-4 pb-6">
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
    <div className="flex min-h-full flex-col gap-5 px-4 pb-6">
      {/* Header + Hero más compactos */}
      <div className="flex flex-col gap-1">
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
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80" aria-label={t("aboutTitle")}>
                <span className="material-symbols-outlined text-xl">info</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("aboutTitle")}</DialogTitle>
                <DialogDescription className="sr-only">{t("aboutDescription")}</DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">{t("aboutDescription")}</p>
              <h4 className="mt-4 font-semibold">{t("howToPlayTitle")}</h4>
              <p className="text-sm text-muted-foreground">{t("howToPlaySteps")}</p>
            </DialogContent>
          </Dialog>
          <Dialog open={reportOpen} onOpenChange={handleReportOpenChange}>
            <DialogTrigger asChild>
              <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80" aria-label={t("reportTitle")}>
                <span className="material-symbols-outlined text-xl">bug_report</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("reportTitle")}</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                  {t("reportDescription")}
                </DialogDescription>
              </DialogHeader>
              {reportStatus === "success" ? (
                <p className="text-sm font-medium text-brand">{t("reportSuccess")}</p>
              ) : (
                <form onSubmit={handleReportSubmit} className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">{t("reportType")}</label>
                    <Select value={reportType} onValueChange={(v) => setReportType(v as "bug" | "error" | "suggestion")}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bug">{t("reportTypeBug")}</SelectItem>
                        <SelectItem value="error">{t("reportTypeError")}</SelectItem>
                        <SelectItem value="suggestion">{t("reportTypeSuggestion")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">{t("reportMessage")}</label>
                    <textarea
                      value={reportMessage}
                      onChange={(e) => setReportMessage(e.target.value)}
                      placeholder={t("reportMessagePlaceholder")}
                      required
                      rows={3}
                      maxLength={2000}
                      className={cn(
                        "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground disabled:opacity-50",
                        "min-h-[72px] resize-y"
                      )}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">{t("reportEmail")}</label>
                    <Input
                      type="email"
                      value={reportEmail}
                      onChange={(e) => setReportEmail(e.target.value)}
                      placeholder={t("reportEmailPlaceholder")}
                      className="w-full"
                    />
                  </div>
                  {reportStatus === "error" && (
                    <p className="text-sm text-destructive">{t("reportError")}</p>
                  )}
                  <Button type="submit" className="w-full" disabled={reportStatus === "sending"}>
                    {reportStatus === "sending" ? t("reportSending") : t("reportSubmit")}
                  </Button>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Today's Challenge Hero */}
      <section>
        <div className="mb-3 flex justify-center">
          <Countdown
            t={t}
            onCountdownUnder10s={handleCountdownUnder10s}
            onCountdownZero={handleCountdownZero}
          />
        </div>

        <motion.div
          role="button"
          tabIndex={0}
          whileTap={{ scale: 0.99 }}
          onClick={() => router.push("/play")}
          onKeyDown={(e) => e.key === "Enter" && router.push("/play")}
          className="relative cursor-pointer overflow-hidden rounded-2xl border border-white/[0.08]"
          style={{ aspectRatio: "4/3" }}
        >
          {/* Fondo: cover con blur cuando completado, sino oscuro */}
          {todaysCompleted && todaysDisplayCover ? (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${todaysDisplayCover})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(1px)",
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-[#0a0f0c]" />
          )}
          {/* Efectos visuales: orbs, stardust y gradiente radial — verde si acertado, rojo si fallido */}
          <div
            className={cn(
              "absolute -top-[10%] -left-[10%] h-[60%] w-[60%] rounded-full blur-[80px] opacity-40",
              todaysCompleted && !todaysWon ? "bg-red-500/20" : "bg-brand/20"
            )}
            aria-hidden
          />
          <div
            className={cn(
              "absolute -bottom-[5%] -right-[5%] h-[50%] w-[50%] rounded-full blur-[80px] opacity-40",
              todaysCompleted && !todaysWon ? "bg-red-600/10" : "bg-emerald-600/10"
            )}
            aria-hidden
          />
          <div
            className="absolute inset-0 opacity-20 pointer-events-none bg-repeat"
            style={{ backgroundImage: "url('https://www.transparenttextures.com/patterns/stardust.png')" }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                todaysCompleted && !todaysWon
                  ? "radial-gradient(circle at 50% 0%, rgba(239, 68, 68, 0.15) 0%, rgba(10, 19, 14, 0.98) 80%)"
                  : "radial-gradient(circle at 50% 0%, rgba(43, 238, 121, 0.15) 0%, rgba(10, 19, 14, 0.98) 80%)",
            }}
          />

          {/* Esquina superior izquierda: fecha + id */}
          <div className="absolute left-4 top-4 rounded-xl bg-white/5 px-3 py-2.5 backdrop-blur-xl">
            <p
              className="text-[10px] font-bold uppercase tracking-widest text-white/60"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              {format(new Date(), "d", { locale: dateFnsLocale })}{" "}
              {format(new Date(), "MMMM", { locale: dateFnsLocale }).toUpperCase()}
              {todaysGame?.game_number != null && (
                <>
                  <span className="text-white/40"> · </span>
                  <span className="tabular-nums">#{todaysGame.game_number}</span>
                </>
              )}
            </p>
          </div>

          {/* Esquina superior derecha: badge (acertado / fallado / en curso / no jugado) */}
          <div className="absolute right-4 top-4 px-3 py-2.5">
            <TodaysCardBadge
              todaysCompleted={todaysCompleted}
              todaysInProgress={todaysInProgress}
              todaysWon={todaysWon}
              t={t}
            />
          </div>

          {/* Waveform decorativa (oculta cuando completado) */}
          {!todaysCompleted && <WaveformBars />}

          {/* Zona central: texto y progreso (entre waveform y botones) */}
          <div
            className="absolute left-0 right-0 flex flex-col items-center justify-center px-4"
            style={{ top: "50%", bottom: "5.5rem" }}
          >
            {todaysCompleted ? (
              <div className="flex flex-col items-center rounded-xl bg-white/5 px-4 py-3 backdrop-blur-xl">
                <h3
                  className="max-w-full text-center text-[1.35rem] font-bold leading-tight text-white line-clamp-2 sm:text-[1.5rem]"
                  style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                  title={todaysDisplayTitle || undefined}
                >
                  {todaysDisplayTitle || "—"}
                </h3>
                {todaysDisplayArtist && (
                  <p
                    className="mt-1 max-w-full text-center text-sm text-white/70 line-clamp-2"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                  >
                    {todaysDisplayArtist}
                  </p>
                )}
              </div>
            ) : null}
            {todaysInProgress && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">
                  {t("progress")}
                </p>
                <div className="flex items-center justify-center gap-1.5">
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
              </div>
            )}
          </div>

          {/* Botones o puntuación */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              {todaysCompleted ? (
                <div className="flex w-fit items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md">
                  <span className={todaysDisplayScore === 0 ? "text-destructive" : "text-brand"}>{t("score")}:</span>
                  <span className={todaysDisplayScore === 0 ? "text-destructive" : "text-brand"}>
                    {(todaysDisplayScore ?? 0).toLocaleString(locale === "es" ? "es" : "en-US")}{" "}
                    {tc("points")}
                  </span>
                </div>
              ) : (
                <div
                  className="flex w-fit items-center justify-center gap-2 rounded-xl px-5 py-2 text-base font-bold text-primary-foreground shadow-[0_0_20px_-4px_rgba(43,238,121,0.4)]"
                  style={{
                    background: "linear-gradient(135deg, #2bee79 0%, #1abc62 50%, #2bee79 100%)",
                  }}
                >
                  <span
                    className="material-symbols-outlined text-lg text-primary-foreground"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    play_arrow
                  </span>
                  {t("playNow")}
                </div>
              )}
              <button
                type="button"
                onClick={handleShareHome}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#282828] text-sky-400 shadow-md transition-all hover:bg-[#383838] hover:text-sky-300 hover:shadow-lg active:scale-95"
              >
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 0" }}>share</span>
              </button>
            </div>
          </div>
        </motion.div>
      </section>
      </div>

      {/* Stats rápidas */}
      {userId ? (
        <section className="grid grid-cols-2 gap-3">
          <StatCard
            label={t("currentStreak")}
            value={`${userStats?.streak ?? 0}`}
            suffix={tc("days")}
            icon="local_fire_department"
            iconColor="text-orange-400"
            iconBg="bg-orange-500/15"
            nextBonus={getNextStreakBonusPoints(userStats?.streak ?? 0)}
            nextBonusSuffix={t("streakBonusNextSuffix")}
          />
          <RankingCard rankingRanks={rankingRanks} t={t} />
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
              <p className="text-sm font-semibold">{t("guestBannerTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("guestBannerDescription")}
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
        onNavigateToGame={undefined}
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
  const baseClass = "inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md";

  const dotColor = todaysCompleted
    ? todaysWon
      ? "bg-brand"
      : "bg-destructive"
    : todaysInProgress
      ? "bg-orange-500"
      : "bg-blue-500";

  if (todaysCompleted) {
    const isWon = todaysWon === true;
    return (
      <div className={baseClass}>
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full animate-pulse", dotColor)}
          style={{ animationDuration: "2s" }}
        />
        <span className={isWon ? "text-brand" : "text-destructive"}>
          {isWon ? t("badgeWon") : t("badgeLost")}
        </span>
      </div>
    );
  }

  if (todaysInProgress) {
    return (
      <div className={baseClass}>
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full animate-pulse", dotColor)}
          style={{ animationDuration: "2s" }}
        />
        {t("badgeInProgress")}
      </div>
    );
  }

  return (
    <div className={baseClass}>
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full animate-pulse", dotColor)}
        style={{ animationDuration: "2s" }}
      />
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

const MS_PER_HOUR = 3600 * 1000;
const PREFETCH_UNDER_MS = 10_000;

function Countdown({
  t,
  onCountdownUnder10s,
  onCountdownZero,
}: {
  t: (key: string) => string;
  onCountdownUnder10s?: () => void;
  onCountdownZero?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [ms, setMs] = useState(0);
  const prevMsRef = useRef<number | null>(null);
  const hasTriggeredRef = useRef(false);
  const hasTriggeredUnder10Ref = useRef(false);

  useEffect(() => {
    setMounted(true);
    setMs(getMsUntilNextMidnightMadrid());
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const tick = () => setMs(getMsUntilNextMidnightMadrid());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (
      onCountdownUnder10s &&
      ms < PREFETCH_UNDER_MS &&
      !hasTriggeredUnder10Ref.current
    ) {
      hasTriggeredUnder10Ref.current = true;
      onCountdownUnder10s();
    }
  }, [mounted, ms, onCountdownUnder10s]);

  useEffect(() => {
    if (!mounted || !onCountdownZero || hasTriggeredRef.current) return;
    const prev = prevMsRef.current;
    prevMsRef.current = ms;
    if (prev !== null && prev < 60000 && ms > MS_PER_HOUR) {
      hasTriggeredRef.current = true;
      onCountdownZero();
    }
  }, [mounted, ms, onCountdownZero]);

  return (
    <span className="text-xs font-medium text-muted-foreground tabular-nums">
      {t("nextSongIn")} {mounted ? formatCountdown(ms) : "—"}
    </span>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    setMatches(m.matches);
    const handler = () => setMatches(m.matches);
    m.addEventListener("change", handler);
    return () => m.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function WaveformBars() {
  const isSm = useMediaQuery("(min-width: 640px)");
  const isMd = useMediaQuery("(min-width: 768px)");

  const { barCount, barWidth, heightBase, heightRange, gap } = useMemo(() => {
    if (isMd) return { barCount: 52, barWidth: 4, heightBase: 12, heightRange: 32, gap: 3 };
    if (isSm) return { barCount: 44, barWidth: 3, heightBase: 10, heightRange: 28, gap: 2.5 };
    return { barCount: 36, barWidth: 2.5, heightBase: 8, heightRange: 24, gap: 2 };
  }, [isSm, isMd]);

  const bars = useMemo(
    () =>
      Array.from({ length: barCount }, (_, i) => ({
        key: i,
        heightA: heightBase + ((i * 7) % Math.round(heightRange)),
        heightB: heightBase + ((i * 11 + 13) % Math.round(heightRange)),
        duration: 0.6 + (i % 10) * 0.08,
        delay: i * 0.02,
      })),
    [barCount, heightBase, heightRange]
  );

  return (
    <div
      className="absolute inset-x-0 top-[52%] flex -translate-y-1/2 items-center justify-center px-4 opacity-60"
      style={{ gap: `${gap}px` }}
    >
      <div
        className="flex items-center justify-center"
        style={{ gap: `${gap}px` }}
      >
      {bars.map(({ key, heightA, heightB, duration, delay }) => (
        <motion.div
          key={key}
          className="rounded-full bg-brand shrink-0"
          style={{ width: `${barWidth}px`, minWidth: `${barWidth}px` }}
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
    </div>
  );
}

function RankingCard({
  rankingRanks,
  t,
}: {
  rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
  t: (key: string) => string;
}) {
  const fmt = (r: number | null) => (r != null ? `#${r}` : "—");
  const global = fmt(rankingRanks?.global ?? null);
  const weekly = fmt(rankingRanks?.weekly ?? null);
  const monthly = fmt(rankingRanks?.monthly ?? null);

  return (
    <Link
      href="/ranking"
      className="flex flex-col rounded-2xl bg-card p-4 transition-colors active:bg-card/70"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/15">
          <span
            className="material-symbols-outlined text-base text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            emoji_events
          </span>
        </div>
        <p className="text-xs font-medium text-muted-foreground">{t("rankingsLabel")}</p>
      </div>
      <div className="flex flex-1 flex-wrap items-end gap-x-3 gap-y-1.5 text-xs sm:gap-x-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{t("globalRank")}</span>
          <span className="font-bold tabular-nums">{global}</span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{t("weeklyRank")}</span>
          <span className="font-bold tabular-nums">{weekly}</span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{t("monthlyRank")}</span>
          <span className="font-bold tabular-nums">{monthly}</span>
        </div>
      </div>
    </Link>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon,
  iconColor,
  iconBg,
  nextBonus,
  nextBonusSuffix,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: string;
  iconColor: string;
  iconBg?: string;
  nextBonus?: number;
  nextBonusSuffix?: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-4 flex flex-col">
      <div className="mb-3 flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            iconBg ?? "bg-muted"
          )}
        >
          <span
            className={cn("material-symbols-outlined text-base", iconColor)}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {icon}
          </span>
        </div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <div className="flex items-end justify-between gap-2">
        {nextBonus != null && nextBonus > 0 && nextBonusSuffix && (
          <p className="text-[10px] text-muted-foreground min-w-0">
            <span className="font-semibold text-brand">+{nextBonus}</span>
            {` ${nextBonusSuffix}`}
          </p>
        )}
        <div className="flex items-end gap-1 shrink-0">
          <span className="text-2xl font-bold">{value}</span>
          {suffix && (
            <span className="mb-0.5 text-sm text-muted-foreground">{suffix}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviousDaysSection({
  previousDays,
  userId,
  inProgressByGameId = {},
  onNavigateToGame,
}: {
  previousDays: PreviousDayGame[];
  userId: string | null;
  inProgressByGameId?: Record<string, import("@/lib/hooks/queries").InProgressProgress>;
  onNavigateToGame?: () => void;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;
  const byGameId = useGameProgressStore((s) => s.byGameId);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [filterYear, setFilterYear] = useState<number | null>(null);
  const [filterMonth, setFilterMonth] = useState<number | null>(null);

  const [nowY, nowM] = getMadridDate().split("-").map(Number);
  const currentMonthKey = `${nowY}-${String(nowM).padStart(2, "0")}`;

  // Estado inicial igual en servidor y cliente para evitar hydration mismatch; sessionStorage se aplica en useEffect
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([currentMonthKey]));
  const hasRestoredRef = useRef(false);

  // Restaurar todo desde sessionStorage al montar (solo cliente); marcar restaurado para no pisar en los efectos de persist
  useEffect(() => {
    try {
      const sOpen = sessionStorage.getItem(HOME_MONTHS_OPEN_STORAGE_KEY);
      if (sOpen) {
        const arr = JSON.parse(sOpen) as string[];
        if (Array.isArray(arr) && arr.length > 0) setOpenMonths(new Set(arr));
      }
    } catch {
      /* ignore */
    }
    try {
      const sFilter = sessionStorage.getItem(PREVIOUS_DAYS_FILTER_STORAGE_KEY);
      if (sFilter) {
        const p = JSON.parse(sFilter) as { filterYear?: number | null; filterMonth?: number | null };
        if (typeof p.filterYear === "number") setFilterYear(p.filterYear);
        if (typeof p.filterMonth === "number") setFilterMonth(p.filterMonth);
      }
    } catch {
      /* ignore */
    }
    try {
      const sView = sessionStorage.getItem(HOME_VIEW_MODE_STORAGE_KEY);
      if (sView === "list" || sView === "grid") setViewMode(sView);
    } catch {
      /* ignore */
    }
    try {
      const sSort = sessionStorage.getItem(HOME_SORT_ORDER_STORAGE_KEY);
      if (sSort === "asc" || sSort === "desc") setSortOrder(sSort);
    } catch {
      /* ignore */
    }
    // Marcar como restaurado en el siguiente tick para que los efectos de persist no escriban con estado inicial
    const id = setTimeout(() => {
      hasRestoredRef.current = true;
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // openMonths: persistir solo cuando el usuario abre/cierra un mes (no al montar, así no pisamos lo restaurado)
  const handleOpenMonthsChange = useCallback((key: string, open: boolean) => {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      try {
        sessionStorage.setItem(HOME_MONTHS_OPEN_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Filtro año/mes, viewMode y sortOrder: solo persistir después de haber restaurado para no pisar storage al montar
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    try {
      sessionStorage.setItem(
        PREVIOUS_DAYS_FILTER_STORAGE_KEY,
        JSON.stringify({ filterYear, filterMonth })
      );
    } catch {
      /* ignore */
    }
  }, [filterYear, filterMonth]);

  // viewMode y sortOrder
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    try {
      sessionStorage.setItem(HOME_VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  useEffect(() => {
    if (!hasRestoredRef.current) return;
    try {
      sessionStorage.setItem(HOME_SORT_ORDER_STORAGE_KEY, sortOrder);
    } catch {
      /* ignore */
    }
  }, [sortOrder]);

  const monthNamesFull =
    locale === "es"
      ? ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
      : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const groupsByMonth = useMemo(() => {
    const map = new Map<string, PreviousDayGame[]>();
    for (const day of previousDays) {
      const [y, m] = day.date.split("-").map(Number);
      const key = `${y}-${String(m).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(day);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (sortOrder === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
    }
    return [...map.entries()].sort(([ka], [kb]) =>
      sortOrder === "asc" ? ka.localeCompare(kb) : kb.localeCompare(ka)
    );
  }, [previousDays, sortOrder]);

  const availableMonthYearPairs = useMemo(() => {
    return groupsByMonth.map(([key]) => {
      const [y, m] = key.split("-").map(Number);
      return { year: y, month: m - 1 };
    });
  }, [groupsByMonth]);

  const filteredGroupsByMonth = useMemo(() => {
    if (filterYear === null && filterMonth === null) return groupsByMonth;
    return groupsByMonth.filter(([key]) => {
      const [y, m] = key.split("-").map(Number);
      if (filterYear !== null && y !== filterYear) return false;
      if (filterMonth !== null && m !== filterMonth + 1) return false;
      return true;
    });
  }, [groupsByMonth, filterYear, filterMonth]);

  const availableYears = useMemo(
    () => [...new Set(availableMonthYearPairs.map((p) => p.year))].sort((a, b) => b - a),
    [availableMonthYearPairs]
  );

  const availableMonthsForYear = useMemo(() => {
    if (filterYear !== null) {
      return availableMonthYearPairs
        .filter((p) => p.year === filterYear)
        .map((p) => p.month)
        .sort((a, b) => a - b);
    }
    return [...new Set(availableMonthYearPairs.map((p) => p.month))].sort((a, b) => a - b);
  }, [availableMonthYearPairs, filterYear]);

  const renderDayCard = (day: PreviousDayGame) => {
            // Usuarios autenticados: servidor (day, inProgressByGameId) es fuente de verdad.
            // Invitados: gameProgressStore.
            const serverInProgress = userId ? inProgressByGameId[day.id] : undefined;
            const localProgress = (serverInProgress ?? byGameId[day.id]) as GameProgress | undefined;
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
              <Link
                key={day.id}
                href={`/play/${day.id}`}
                onClick={onNavigateToGame}
              >
                <motion.div
                  whileTap={{ scale: 0.99 }}
                  className={cn(
                    "border-0 transition-colors active:opacity-90",
                    viewMode === "list"
                      ? "flex items-center gap-3 rounded-2xl bg-card p-3 active:bg-card/70"
                      : "flex flex-col rounded-2xl bg-card active:bg-card/70"
                  )}
                >
                  {viewMode === "grid" ? (
                    /* Grid: fecha encima de la portada (centrada), portada, id debajo */
                    <div className="flex h-full flex-col rounded-2xl px-3 py-1.5">
                      <p className="mb-1.5 text-center text-[10px] text-muted-foreground">
                        {format(parseISO(day.date), "d MMM", { locale: dateFnsLocale })}
                      </p>
                      <div className="relative mb-1.5 aspect-square w-full shrink-0 overflow-hidden rounded-xl">
                        {played && displayCover ? (
                          <Image src={displayCover} alt={displayTitle || "Album"} fill className="object-cover" sizes="160px" />
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
                      <p className="text-center text-[10px] tabular-nums text-muted-foreground/70">
                        #{day.game_number}
                      </p>
                    </div>
                  ) : (
                    <>
                  {/* Miniatura: carátula real si jugado, placeholder con color estable si no */}
                  <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl">
                    {played && displayCover ? (
                      <Image src={displayCover} alt={displayTitle || "Album"} fill className="object-cover" sizes="56px" />
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
                      <p className={cn("text-xs font-medium", displayScore === 0 ? "text-destructive" : "text-brand")}>
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
  };

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
          <Dialog>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/30">
              <DialogTrigger asChild>
                <button
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50",
                    filterMonth !== null || filterYear !== null ? "text-brand" : ""
                  )}
                  aria-label={t("filterByDate")}
                >
                  <span className="material-symbols-outlined text-lg">filter_list</span>
                </button>
              </DialogTrigger>
            </div>
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle>{t("filterByDate")}</DialogTitle>
                <DialogDescription className="sr-only">{t("filterByDate")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t("filterYear")}</label>
                  <Select
                    value={filterYear != null ? String(filterYear) : "all"}
                    onValueChange={(v) => {
                      const newYear = v === "all" ? null : Number(v);
                      setFilterYear(newYear);
                      if (newYear !== null && filterMonth !== null) {
                        const valid = availableMonthYearPairs.some(
                          (p) => p.year === newYear && p.month === filterMonth
                        );
                        if (!valid) setFilterMonth(null);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("filterAll")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filterAll")}</SelectItem>
                      {availableYears.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t("filterMonth")}</label>
                  <Select
                    value={filterMonth != null ? String(filterMonth) : "all"}
                    onValueChange={(v) => setFilterMonth(v === "all" ? null : Number(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("filterAll")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filterAll")}</SelectItem>
                      {availableMonthsForYear.map((i) => (
                        <SelectItem key={i} value={String(i)}>
                          {monthNamesFull[i]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <button
                  onClick={() => {
                    setFilterMonth(null);
                    setFilterYear(null);
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

      {previousDays.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t("noPreviousDays")}
        </p>
      ) : filteredGroupsByMonth.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t("noGamesInPeriod")}
        </p>
      ) : filteredGroupsByMonth.length === 1 ? (
        <div
          className={cn(
            "gap-2",
            viewMode === "list" ? "flex flex-col" : "grid grid-cols-4 gap-2"
          )}
        >
          {filteredGroupsByMonth[0][1].map((day) => (
            <div key={day.id}>{renderDayCard(day)}</div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredGroupsByMonth.map(([key, days]) => {
            const [y, m] = key.split("-").map(Number);
            const monthLabel = `${monthNamesFull[m - 1]} ${y}`;
            const isOpen = openMonths.has(key);
            return (
              <Collapsible
                key={key}
                open={isOpen}
                onOpenChange={(open) => handleOpenMonthsChange(key, open)}
                className="group"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left font-medium transition-colors hover:bg-muted/50"
                  >
                    <span>{monthLabel}</span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      {t("gamesCount", { count: days.length })}
                      <span className="material-symbols-outlined text-lg transition-transform group-data-[state=open]:rotate-180">
                        expand_more
                      </span>
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div
                    className={cn(
                      "mt-2 gap-2",
                      viewMode === "list" ? "flex flex-col" : "grid grid-cols-4 gap-2"
                    )}
                  >
                    {days.map((day) => (
                      <div key={day.id}>{renderDayCard(day)}</div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </section>
  );
}
