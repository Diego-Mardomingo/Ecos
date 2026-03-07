"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";
import type { User } from "@supabase/supabase-js";
import type { GameWithSong } from "@/lib/queries/games";
import type { UserStats } from "@/lib/queries/users";
import { cn } from "@/lib/utils";

interface Props {
  todaysGame: GameWithSong | null;
  userStats: UserStats | null;
  user: User | null;
}

export function HomeClient({ todaysGame, userStats, user }: Props) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 pb-6 pt-safe">
      {/* Header */}
      <header className="sticky top-0 z-30 -mx-4 flex items-center justify-between px-4 py-3 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}>
        <div className="flex items-center gap-2">
          <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand/20">
            <Image
              src="/ecos_favicon_v2_32.png"
              alt=""
              width={32}
              height={32}
              className="object-contain"
            />
          </div>
          <span className="text-lg font-bold tracking-tight">{tc("appName")}</span>
        </div>
        <button className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80">
          <span className="material-symbols-outlined text-xl">notifications</span>
        </button>
      </header>

      {/* Today's Challenge Hero */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("todaysChallenge")}</h2>
          <span className="flex items-center gap-1.5 rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            {tc("liveNow")}
          </span>
        </div>

        <motion.div
          whileTap={{ scale: 0.99 }}
          className="relative overflow-hidden rounded-2xl"
          style={{ aspectRatio: "4/3" }}
        >
          {/* Artwork de fondo */}
          {todaysGame?.ecos_songs.cover_url ? (
            <Image
              src={todaysGame.ecos_songs.cover_url}
              alt="Album cover"
              fill
              className="object-cover"
              priority
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-brand/20 to-card" />
          )}

          {/* Overlay gradiente */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

          {/* Badge jugadores */}
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md">
            <span className="material-symbols-outlined text-sm text-brand"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              whatshot
            </span>
            12k {t("playing")}
          </div>

          {/* Waveform decorativa animada */}
          <div className="absolute left-0 right-0 top-1/3 flex items-center justify-center gap-[3px] px-8 opacity-60">
            {Array.from({ length: 40 }).map((_, i) => (
              <motion.div
                key={i}
                className="w-[3px] rounded-full bg-brand"
                animate={{
                  height: [
                    `${8 + Math.random() * 24}px`,
                    `${8 + Math.random() * 24}px`,
                  ],
                }}
                transition={{
                  duration: 0.6 + Math.random() * 0.8,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                  delay: i * 0.03,
                }}
              />
            ))}
          </div>

          {/* Info y acciones */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <p className="mb-1 text-xs font-medium text-white/70">
              {format(new Date(), "d 'de' MMMM, yyyy", { locale: dateFnsLocale })}
            </p>
            <h3 className="mb-3 text-2xl font-bold text-white">{t("guessTheHit")}</h3>
            <div className="flex items-center gap-3">
              <Link
                href="/play"
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-[#0a2015] transition-all active:scale-95"
              >
                <span className="material-symbols-outlined text-lg"
                  style={{ fontVariationSettings: "'FILL' 1" }}>
                  play_arrow
                </span>
                {t("playNow")}
              </Link>
              <button className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-all active:scale-95">
                <span className="material-symbols-outlined text-xl">share</span>
              </button>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Stats rápidas */}
      {user ? (
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
      <PreviousDaysSection />
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

function PreviousDaysSection() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;

  // Días de ejemplo (en producción vendrían del servidor)
  const mockDays = [
    { id: "1", date: "2026-03-05", game_number: 41, played: true, won: true, score: 4500, cover_url: "", title: "Yesterday's Jam", artist_name: "Artist" },
    { id: "2", date: "2026-03-04", game_number: 40, played: false, won: false, score: null, cover_url: "", title: "Missed Opportunity", artist_name: "Artist" },
    { id: "3", date: "2026-03-03", game_number: 39, played: true, won: true, score: 3200, cover_url: "", title: "Retro Vibes", artist_name: "Artist" },
    { id: "4", date: "2026-03-02", game_number: 38, played: false, won: false, score: null, cover_url: "", title: "Sunday Chill", artist_name: "Artist" },
  ];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("previousDays")}</h2>
        <button className="text-sm font-medium text-brand">{tc("viewAll")}</button>
      </div>

      <div className="flex flex-col gap-2">
        {mockDays.map((day) => (
          <motion.div
            key={day.id}
            whileTap={{ scale: 0.99 }}
            className="flex items-center gap-3 rounded-2xl bg-card p-3 transition-colors active:bg-card/70"
          >
            {/* Miniatura */}
            <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl">
              {day.cover_url ? (
                <Image src={day.cover_url} alt={day.title} fill className="object-cover" />
              ) : (
                <div
                  className={cn(
                    "h-full w-full",
                    day.played && day.won
                      ? "bg-gradient-to-br from-brand/40 to-brand/10"
                      : day.played
                      ? "bg-gradient-to-br from-red-500/30 to-card"
                      : "bg-gradient-to-br from-purple-500/30 to-indigo-600/30"
                  )}
                />
              )}
              {/* Overlay de estado */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className={cn(
                    "material-symbols-outlined text-xl",
                    day.played && day.won ? "text-brand" : "text-white/80"
                  )}
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  {day.played && day.won
                    ? "check_circle"
                    : day.played
                    ? "cancel"
                    : "play_arrow"}
                </span>
              </div>
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {format(parseISO(day.date), "d MMM", { locale: dateFnsLocale })}
              </p>
              <p className="truncate font-semibold">{day.title}</p>
              {day.played && day.score !== null ? (
                <p className="text-xs font-medium text-brand">
                  {t("score")}: {day.score.toLocaleString(locale === "es" ? "es" : "en-US")} {tc("points")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("notPlayedYet")}</p>
              )}
            </div>

            <span className="material-symbols-outlined text-muted-foreground">
              {day.played ? "chevron_right" : "play_circle"}
            </span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
