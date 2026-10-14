"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { m } from "framer-motion";
import { toast } from "sonner";
import { GuessInput, type EcosSong } from "@/components/guess-input/GuessInput";
import type { AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import { PlayingAudioSection } from "@/components/game/GameAudioSection";
import { PreviousAttempts } from "@/components/game/GameAttemptsList";
import { GameBackdrop } from "@/components/game/GameBackdrop";
import { CategoryHeader } from "@/components/categories/CategoryHeader";
import { CategoryRanking } from "@/components/categories/CategoryRanking";
import { RevealedSong } from "@/components/categories/RevealedSong";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  useAbandonCategoryRunMutation,
  useCategories,
  useCategoryGuessMutation,
  useCategoryRanking,
  useCategorySkipMutation,
  useStartCategoryRunMutation,
  type CategoryRunOutcome,
} from "@/lib/hooks/queries";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { categoryAudioKey, prefetchGameAudio } from "@/lib/audio/audioStore";
import { categoryName } from "@/lib/categories/display";
import type {
  CategoriesResponse,
  CategoryRankingResponse,
  CategoryRunEndReason,
  CategoryRunGuess,
  CategoryRunState,
  CategorySummary,
} from "@/lib/categories/types";
import { MAX_ATTEMPTS } from "@/lib/server-attempt";
import { ATTEMPT_DURATIONS, SKIPPED_GUESS_TEXT, type GuessEntry } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";

/**
 * Partida por categorías (racha infinita) de un usuario con sesión. Una sola rama: todo lo decide
 * el servidor y la canción actual no llega al cliente hasta que se resuelve (`lastRound`).
 *
 * Cada jugada manda `roundNumber` y `attempt` del último estado recibido. Sin actualización
 * optimista y sin reintentos: la pantalla pasa a lo que responde el servidor, y si responde 409
 * (otra pestaña, un reintento viejo) se adopta su estado real.
 *
 * Pantallas: inicio (aún sin partida cargada: empezar o continuar, y la clasificación), juego,
 * revelación entre canciones y fin de partida (resumen, jugar otra vez y la clasificación).
 */

/** Ventana corta para ignorar dobles taps accidentales en «Saltar» (igual que el diario). */
const SKIP_BUTTON_DOUBLE_TAP_GUARD_MS = 500;
const EASE_OUT = "[--tw-ease:cubic-bezier(0.22,1,0.36,1)]";
const RANKING_SECTION_ID = "category-ranking";

interface Props {
  category: CategorySummary;
  userId: string;
  /** Lista de categorías con la marca del usuario (la misma caché que la lista). */
  initialCategories: CategoriesResponse;
  initialRanking: CategoryRankingResponse;
}

/** Intentos de la canción actual en la forma que pintan la onda y la lista de intentos. */
function toGuessEntries(guesses: CategoryRunGuess[]): GuessEntry[] {
  return guesses.map((g) => ({
    text: g.skipped ? SKIPPED_GUESS_TEXT : g.text,
    correct: false,
    correctArtist: g.correctArtist,
    correctAlbum: g.correctAlbum,
    attemptNumber: g.attempt,
  }));
}

/** Clave de la canción en curso (partida + número de canción) para la revelación. */
function roundKey(run: CategoryRunState): string {
  return `${run.runId}:${run.roundNumber}`;
}

function audioDurationFor(attempt: number): number {
  return ATTEMPT_DURATIONS[Math.min(Math.max(attempt, 1), ATTEMPT_DURATIONS.length) - 1] ?? 30;
}

/**
 * Qué hacer con un error de una petición: clave del aviso (nunca el texto crudo del servidor, que
 * llega en inglés) y si la partida cargada ya no existe. Vive fuera del componente.
 */
function failureOf(error: unknown): {
  namespace: "game" | "categories";
  key: string;
  resetRun: boolean;
} {
  if (error instanceof ApiError) {
    if (error.status === 401) return { namespace: "game", key: "sessionExpiredError", resetRun: false };
    if (error.status === 404) return { namespace: "categories", key: "runNotFound", resetRun: true };
    if (error.status === 409) return { namespace: "categories", key: "noSongs", resetRun: false };
  }
  // `fetch` rechaza con TypeError cuando no hay red o se corta la conexión.
  if (error instanceof TypeError) return { namespace: "game", key: "networkError", resetRun: false };
  return { namespace: "categories", key: "moveError", resetRun: false };
}

const END_REASON_KEYS: Record<CategoryRunEndReason, string> = {
  failed: "endFailed",
  abandoned: "endAbandoned",
  exhausted: "endExhausted",
};

function StatTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-2xl border border-border bg-card px-3 py-3">
      <span
        aria-hidden
        className="material-symbols-outlined text-xl text-brand"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </span>
      <span className="text-xl font-bold tabular-nums leading-none">{value}</span>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

const primaryButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3.5 text-sm font-bold text-primary-foreground shadow-[0_8px_24px_-8px_var(--brand)] transition-transform active:scale-[0.97] disabled:opacity-60";
const secondaryButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card/70 px-6 py-3 text-sm font-semibold text-foreground transition-[transform,border-color] hover:border-brand/40 active:scale-[0.97]";

function AbandonDialog({
  open,
  onOpenChange,
  streak,
  points,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streak: number;
  points: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("categories");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("abandonTitle")}</DialogTitle>
          <DialogDescription>{t("abandonDescription", { streak, points })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onConfirm} disabled={pending} className={primaryButton}>
            {t("abandonConfirm")}
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className={secondaryButton}>
            {t("abandonCancel")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CategoryGameClient({ category, userId, initialCategories, initialRanking }: Props) {
  const t = useTranslations("categories");
  const tg = useTranslations("game");
  const locale = useLocale();
  const { formatNumber } = useAppFormatters();
  const name = categoryName(category, locale);

  const startMutation = useStartCategoryRunMutation();
  const guessMutation = useCategoryGuessMutation();
  const skipMutation = useCategorySkipMutation();
  const abandonMutation = useAbandonCategoryRunMutation();
  const busy =
    startMutation.isPending ||
    guessMutation.isPending ||
    skipMutation.isPending ||
    abandonMutation.isPending;

  const { data: categoriesData } = useCategories(userId, initialCategories);
  const { data: rankingData } = useCategoryRanking(category.slug, userId, initialRanking);
  const mine = categoriesData?.user?.[category.id];

  /** Partida cargada; `null` hasta que se pulsa empezar o continuar. */
  const [run, setRun] = useState<CategoryRunState | null>(null);
  /** Revelación ya cerrada (`partida:canción`). Con la clave y no el número, otra partida no la hereda. */
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const playerRef = useRef<AudioPlayerHandle | null>(null);
  const lastSkipTapAtRef = useRef(0);

  // El MP3 de la canción en curso empieza a bajar en cuanto se conoce la partida (también durante
  // la revelación de la anterior), sin esperar a que monte el reproductor. Solo efecto externo.
  const audioKey =
    run && run.status === "active" ? categoryAudioKey(run.runId, run.roundNumber) : undefined;
  useEffect(() => {
    if (audioKey) prefetchGameAudio(audioKey, "categoría");
  }, [audioKey]);

  /** Adopta el estado que dice el servidor (también en el 409, avisando de que se actualizó). */
  const reconcile = (outcome: CategoryRunOutcome) => {
    setRun(outcome.run);
    if (outcome.kind === "conflict") toast.info(t("outOfSync"));
  };

  const handleFailure = (error: unknown) => {
    const failure = failureOf(error);
    toast.error(failure.namespace === "game" ? tg(failure.key) : t(failure.key));
    if (failure.resetRun) setRun(null);
  };

  const handleStart = () => {
    if (busy) return;
    startMutation.mutate({ slug: category.slug }, { onSuccess: reconcile, onError: handleFailure });
  };

  const handleGuess = (song: EcosSong) => {
    if (busy || !run || run.status !== "active") return;
    guessMutation.mutate(
      {
        runId: run.runId,
        roundNumber: run.roundNumber,
        attemptNumber: run.attempt,
        guessText: `${song.title} - ${song.artist_name}`,
        songId: song.id,
      },
      { onSuccess: reconcile, onError: handleFailure }
    );
  };

  const handleSkip = () => {
    playerRef.current?.stopIfPlaying();
    if (busy || !run || run.status !== "active") return;
    const now = Date.now();
    if (now - lastSkipTapAtRef.current < SKIP_BUTTON_DOUBLE_TAP_GUARD_MS) return;
    lastSkipTapAtRef.current = now;
    skipMutation.mutate(
      { runId: run.runId, roundNumber: run.roundNumber, attemptNumber: run.attempt },
      { onSuccess: reconcile, onError: handleFailure }
    );
  };

  const handleAbandon = () => {
    if (!run || run.status !== "active") return;
    abandonMutation.mutate(
      { runId: run.runId },
      {
        onSuccess: (outcome) => {
          setAbandonOpen(false);
          reconcile(outcome);
        },
        onError: (error) => {
          setAbandonOpen(false);
          handleFailure(error);
        },
      }
    );
  };

  // ------------------------------------------------------------------------------------------
  // Fin de partida
  // ------------------------------------------------------------------------------------------

  if (run && run.status === "ended") {
    const lastRound = run.lastRound ?? null;
    const myRow = rankingData?.entries.find((e) => e.user_id === userId) ?? rankingData?.me ?? null;
    const rank = run.points > 0 ? (myRow?.rank ?? null) : null;
    const exhausted = run.endReason === "exhausted";

    return (
      <div className="relative flex min-h-dvh flex-col bg-background">
        <GameBackdrop cover={lastRound?.song.cover_url} />
        <div className="relative z-10 flex flex-1 flex-col">
          <CategoryHeader name={name} />
          <div className="flex flex-col items-center gap-6 px-5 pb-10 pt-6">
            {lastRound ? (
              <RevealedSong
                song={lastRound.song}
                won={lastRound.outcome === "correct"}
                verdict={lastRound.outcome === "correct" ? t("correctTitle") : tg("lostTitle")}
              />
            ) : null}

            <section
              className={cn(
                "flex w-full flex-col gap-3 text-center animate-in fade-in slide-in-from-bottom-4 animation-duration-500 [--tw-animation-delay:350ms] fill-mode-backwards",
                EASE_OUT
              )}
            >
              <div>
                <h2 className="text-lg font-bold">
                  {exhausted ? t("endTitleExhausted") : t("endTitle")}
                </h2>
                {run.endReason ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t(END_REASON_KEYS[run.endReason])}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-3">
                <StatTile
                  icon="local_fire_department"
                  label={t("streakLabel")}
                  value={String(run.streak)}
                />
                <StatTile icon="emoji_events" label={t("pointsLabel")} value={formatNumber(run.points)} />
              </div>
              {rank != null ? (
                <p className="rounded-2xl border border-brand/30 bg-brand/10 px-3.5 py-2.5 text-sm font-semibold">
                  {t("yourRank", { rank })}
                </p>
              ) : null}
              <button type="button" onClick={handleStart} disabled={busy} className={primaryButton}>
                <span aria-hidden className="material-symbols-outlined text-xl">
                  replay
                </span>
                {t("playAgain")}
              </button>
              <a href={`#${RANKING_SECTION_ID}`} className={secondaryButton}>
                <span aria-hidden className="material-symbols-outlined text-xl">
                  leaderboard
                </span>
                {t("viewRanking")}
              </a>
            </section>

            <div className="w-full pt-2 text-left">
              <CategoryRanking
                id={RANKING_SECTION_ID}
                slug={category.slug}
                userId={userId}
                initialData={initialRanking}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------------------------------
  // Revelación entre canciones (acierto)
  // ------------------------------------------------------------------------------------------

  if (run && run.lastRound && dismissedKey !== roundKey(run)) {
    const { lastRound } = run;
    return (
      <div className="relative flex min-h-dvh flex-col bg-background">
        <GameBackdrop cover={lastRound.song.cover_url} />
        <div className="relative z-10 flex flex-1 flex-col">
          <CategoryHeader name={name} stats={{ streak: run.streak, points: run.points }} />
          <div className="flex flex-1 flex-col items-center gap-6 px-5 pb-10 pt-6">
            <RevealedSong song={lastRound.song} won verdict={t("correctTitle")} />
            <div
              className={cn(
                "flex w-full flex-col items-center gap-1 animate-in fade-in zoom-in-90 animation-duration-500 [--tw-animation-delay:400ms] fill-mode-backwards",
                EASE_OUT
              )}
            >
              <p className="text-4xl font-black tabular-nums text-brand">
                {t("pointsGained", { points: formatNumber(lastRound.pointsGained) })}
              </p>
              <p className="text-xs font-medium text-muted-foreground">
                {t("correctInAttempt", { attempt: lastRound.attempt, max: MAX_ATTEMPTS })}
              </p>
            </div>
            <div className="mt-auto flex w-full flex-col gap-2">
              <button
                type="button"
                onClick={() => setDismissedKey(roundKey(run))}
                className={primaryButton}
              >
                {t("nextSong")}
                <span aria-hidden className="material-symbols-outlined text-xl">
                  arrow_forward
                </span>
              </button>
              <button
                type="button"
                onClick={() => setAbandonOpen(true)}
                className="mx-auto rounded-full px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("abandon")}
              </button>
            </div>
          </div>
        </div>
        <AbandonDialog
          open={abandonOpen}
          onOpenChange={setAbandonOpen}
          streak={run.streak}
          points={formatNumber(run.points)}
          pending={abandonMutation.isPending}
          onConfirm={handleAbandon}
        />
      </div>
    );
  }

  // ------------------------------------------------------------------------------------------
  // Partida en curso
  // ------------------------------------------------------------------------------------------

  if (run) {
    const guesses = toGuessEntries(run.guesses);
    const key = categoryAudioKey(run.runId, run.roundNumber);

    return (
      <div className="relative flex flex-col bg-background">
        <GameBackdrop />
        <div className="relative z-10 flex flex-col">
          <CategoryHeader
            name={name}
            stats={{ streak: run.streak, points: run.points }}
            action={
              <m.button
                type="button"
                onClick={handleSkip}
                disabled={busy}
                whileTap={{ scale: 0.92 }}
                // El pseudo-elemento amplía la zona táctil a 44 px de alto sin cambiar el aspecto
                // (el botón mide 40) (UX-12).
                className="group relative flex h-10 items-center gap-1 rounded-full border border-border bg-card/70 pl-3 pr-2.5 text-sm font-semibold text-muted-foreground transition-colors before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] hover:border-brand/40 hover:text-foreground disabled:opacity-60"
              >
                {tg("skip")}
                <span
                  aria-hidden
                  className="material-symbols-outlined text-xl transition-transform duration-200 group-hover:translate-x-0.5 group-active:translate-x-1"
                >
                  skip_next
                </span>
              </m.button>
            }
          />

          {/* `key` por canción: la onda, el reloj y el reproductor empiezan de cero con cada una. */}
          <PlayingAudioSection
            key={key}
            seed={key}
            audioKey={key}
            audioDuration={audioDurationFor(run.attempt)}
            guesses={guesses}
            maxAttempts={MAX_ATTEMPTS}
            isGuest={false}
            playerRef={playerRef}
          >
            <GuessInput
              onGuess={handleGuess}
              disabled={busy}
              alreadyGuessedTexts={guesses.map((g) => g.text)}
            />
            {guesses.length > 0 ? <PreviousAttempts guesses={guesses} /> : null}
            <button
              type="button"
              onClick={() => setAbandonOpen(true)}
              className="mx-auto mt-6 flex rounded-full px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("abandon")}
            </button>
          </PlayingAudioSection>
        </div>
        <AbandonDialog
          open={abandonOpen}
          onOpenChange={setAbandonOpen}
          streak={run.streak}
          points={formatNumber(run.points)}
          pending={abandonMutation.isPending}
          onConfirm={handleAbandon}
        />
      </div>
    );
  }

  // ------------------------------------------------------------------------------------------
  // Inicio: aún no hay partida cargada
  // ------------------------------------------------------------------------------------------

  const activeRun = mine?.activeRun ?? null;

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <GameBackdrop />
      <div className="relative z-10 flex flex-1 flex-col">
        <CategoryHeader name={name} />
        <div className="flex flex-col gap-6 px-5 pb-10 pt-6">
          <section
            className={cn(
              "flex flex-col items-center gap-3 text-center animate-in fade-in slide-in-from-bottom-3 animation-duration-400 fill-mode-backwards",
              EASE_OUT
            )}
          >
            <span className="flex size-20 items-center justify-center rounded-3xl bg-brand/15 text-brand ring-1 ring-brand/30">
              <span
                aria-hidden
                className="material-symbols-outlined text-[40px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {category.icon}
              </span>
            </span>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">{name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("songsCount", { count: category.pool_size })}
              </p>
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">{t("rules")}</p>
          </section>

          {mine && mine.bestPoints > 0 ? (
            <div className="flex gap-3">
              <StatTile icon="emoji_events" label={t("bestPoints")} value={formatNumber(mine.bestPoints)} />
              <StatTile icon="local_fire_department" label={t("bestStreak")} value={String(mine.bestStreak)} />
            </div>
          ) : null}

          <button type="button" onClick={handleStart} disabled={busy} className={primaryButton}>
            <span
              aria-hidden
              className="material-symbols-outlined text-xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              play_arrow
            </span>
            {activeRun
              ? t("continueWithStats", {
                  streak: activeRun.streak,
                  points: formatNumber(activeRun.points),
                })
              : t("start")}
          </button>

          <CategoryRanking
            id={RANKING_SECTION_ID}
            slug={category.slug}
            userId={userId}
            initialData={initialRanking}
          />
        </div>
      </div>
    </div>
  );
}
