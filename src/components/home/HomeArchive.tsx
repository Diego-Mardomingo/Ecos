"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { format, parseISO } from "date-fns";
import { getEffectiveGameDate, shiftMonthKey } from "@/lib/date-utils";
import { useGameProgressStore } from "@/lib/store/gameProgressStore";
import { ATTEMPT_DURATIONS } from "@/lib/store/gameStore";
import { attemptFromScore } from "@/lib/scoring";
import type { InProgressProgress } from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import { cn } from "@/lib/utils";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import type { PlaySkeletonVariant } from "@/lib/navigation/playSkeletonStorage";
import { useRouter } from "@/i18n/navigation";
import { deriveHomeDayFromHistory, type DerivedHomeDayState } from "@/components/home/homeDayDerived";
import { HOME_ARCHIVE_MONTH_STORAGE_KEY } from "@/components/home/homeHelpers";
import { usePrefetchPlayRoute } from "@/components/home/usePrefetchPlayRoute";

/**
 * Archivo de la home (mockup «Escenario»): un mes navegable en calendario.
 *
 * Cada día enseña su carátula y el intento del acierto, una ✕ si se falló, un borde discontinuo si
 * está pendiente y un punto naranja si está a medias. Tocar un día lo selecciona y abre su ficha
 * debajo, con el botón para jugarlo o verlo; un aviso al pie empuja a jugar los pendientes del mes.
 *
 * El estado de cada día sale del histórico de la home (`deriveHomeDayFromHistory`). El de hoy lo
 * pasa `HomeClient` ya resuelto: la celda se pinta como cualquier otro día, con un anillo que la
 * distingue, y cuenta en el resumen del mes en cuanto se juega.
 */

/** Desplazamiento horizontal (px) a partir del cual un arrastre sobre el calendario cambia de mes. */
const SWIPE_THRESHOLD_PX = 56;

/** Iniciales de los días, lunes primero. En español, «X» para el miércoles, como en los calendarios. */
const WEEKDAY_INITIALS: Record<string, string[]> = {
  es: ["L", "M", "X", "J", "V", "S", "D"],
  en: ["M", "T", "W", "T", "F", "S", "S"],
};

type TodayInfo = {
  date: string;
  gameNumber: number;
  /** Estado del reto de hoy, con la misma forma que el de los días anteriores. */
  derived: DerivedHomeDayState;
} | null;

type CellStatus = "future" | "empty" | "won" | "lost" | "playing" | "pending";

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(key: string, delta: number): string {
  return shiftMonthKey(key, delta) ?? key;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cellStatus(d: DerivedHomeDayState | undefined): CellStatus {
  if (!d) return "empty";
  if (d.completed) return d.won ? "won" : "lost";
  if (d.inProgress) return "playing";
  return "pending";
}

function HomeArchive({
  previousDays,
  userId,
  inProgressByGameId = {},
  onNavigateToGame,
  today,
  onPlayToday,
}: {
  previousDays: PreviousDayGame[];
  userId: string | null;
  inProgressByGameId?: Record<string, InProgressProgress>;
  onNavigateToGame?: (variant: PlaySkeletonVariant) => void;
  today: TodayInfo;
  onPlayToday: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("home");
  const locale = useLocale();
  const { dateFnsLocale, formatNumber } = useAppFormatters();
  const byGameId = useGameProgressStore((s) => s.byGameId);
  /** Un arrastre no debe acabar en selección al soltar sobre un día. */
  const pannedRef = useRef(false);

  const todayDate = today?.date ?? getEffectiveGameDate();
  const currentMonth = monthKeyOf(todayDate);

  const [month, setMonth] = useState(currentMonth);
  /** Sentido del último cambio de mes, para que la animación entre por el lado correcto. */
  const [direction, setDirection] = useState<1 | -1>(-1);
  /** Día seleccionado (yyyy-MM-dd). `null` = el que toque por defecto en el mes. */
  const [selected, setSelected] = useState<string | null>(null);

  // Restaurar el mes que se estaba viendo al volver de una partida. Ajuste en render, no en un
  // efecto: `mounted` es false en servidor y al hidratar, así que el HTML coincide.
  const mounted = useIsMounted();
  const [restored, setRestored] = useState(false);
  if (mounted && !restored) {
    setRestored(true);
    try {
      const saved = sessionStorage.getItem(HOME_ARCHIVE_MONTH_STORAGE_KEY);
      if (saved && /^\d{4}-\d{2}$/.test(saved) && saved <= currentMonth) setMonth(saved);
    } catch {
      /* ignore */
    }
  }

  const dayByDate = useMemo(() => {
    const map = new Map<string, PreviousDayGame>();
    for (const d of previousDays) map.set(d.date, d);
    return map;
  }, [previousDays]);

  const oldestMonth = useMemo(() => {
    let oldest = currentMonth;
    for (const d of previousDays) if (d.date < oldest) oldest = d.date;
    return monthKeyOf(oldest);
  }, [previousDays, currentMonth]);

  const prefetchPlayRoute = usePrefetchPlayRoute(userId);

  const derivedById = useMemo(() => {
    const map = new Map<string, DerivedHomeDayState>();
    for (const day of previousDays) {
      map.set(day.id, deriveHomeDayFromHistory(day, userId, inProgressByGameId[day.id], byGameId));
    }
    return map;
  }, [previousDays, inProgressByGameId, userId, byGameId]);

  // --- Mes a la vista ------------------------------------------------------------------------
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const leadingBlanks = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const monthLabel = capitalize(format(new Date(y, m - 1, 1), "LLLL yyyy", { locale: dateFnsLocale }));
  const monthName = format(new Date(y, m - 1, 1), "LLLL", { locale: dateFnsLocale });

  type Cell = {
    date: string;
    dayNum: number;
    status: CellStatus;
    isToday?: boolean;
    game?: PreviousDayGame;
    derived?: DerivedHomeDayState;
  };
  const cells: Cell[] = [];
  let todayCell: Cell | null = null;
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const date = `${month}-${String(dayNum).padStart(2, "0")}`;
    if (date === todayDate && today) {
      todayCell = { date, dayNum, status: cellStatus(today.derived), isToday: true, derived: today.derived };
      cells.push(todayCell);
      continue;
    }
    if (date > todayDate) {
      cells.push({ date, dayNum, status: "future" });
      continue;
    }
    const game = dayByDate.get(date);
    const derived = game ? derivedById.get(game.id) : undefined;
    cells.push({ date, dayNum, status: game ? cellStatus(derived) : "empty", game, derived });
  }

  const past = cells.filter((c) => c.game);
  /** Retos del mes hasta hoy, el de hoy incluido: cuenta en el resumen en cuanto se juega. */
  const monthGames = todayCell ? [...past, todayCell] : past;
  const played = monthGames.filter((c) => c.status === "won" || c.status === "lost").length;
  const hits = monthGames.filter((c) => c.status === "won").length;
  // El de hoy no entra en «pendientes»: ya está arriba, en la tarjeta del reto.
  const pending = past.filter((c) => c.status === "pending" || c.status === "playing");
  /** Acierto del mes: de las partidas terminadas, cuántas se acertaron. */
  const hitRatio = played ? hits / played : 0;

  // Selección por defecto: el pendiente más reciente; si no hay, el último día con reto.
  const defaultSelected =
    [...pending].reverse()[0]?.date ?? [...past].reverse()[0]?.date ?? (month === currentMonth ? todayDate : null);
  const selectedDate = selected && monthKeyOf(selected) === month ? selected : defaultSelected;
  const selectedCell = cells.find((c) => c.date === selectedDate);

  const goToMonth = useCallback(
    (next: string) => {
      if (next > currentMonth || next < oldestMonth) return;
      setDirection(next > month ? 1 : -1);
      setMonth(next);
      setSelected(null);
      try {
        sessionStorage.setItem(HOME_ARCHIVE_MONTH_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    },
    [currentMonth, oldestMonth, month]
  );

  const openGame = (cell: Cell) => {
    if (!cell.game) return;
    onNavigateToGame?.(cell.status === "won" || cell.status === "lost" ? "completed" : "in_progress");
    router.push(`/play/${cell.game.id}`);
  };

  const handlePanEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) < SWIPE_THRESHOLD_PX || Math.abs(info.offset.x) < Math.abs(info.offset.y)) return;
    if (info.offset.x < 0 && month < currentMonth) goToMonth(shiftMonth(month, 1));
    if (info.offset.x > 0 && month > oldestMonth) goToMonth(shiftMonth(month, -1));
  };

  const statusLabel = (status: CellStatus) =>
    status === "won"
      ? t("legendWon")
      : status === "lost"
        ? t("legendLost")
        : status === "playing"
          ? t("legendInProgress")
          : t("legendNotPlayed");

  if (previousDays.length === 0 && !today) {
    return (
      <p className="rounded-[22px] border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        {t("noPreviousDays")}
      </p>
    );
  }

  const ringCircumference = 2 * Math.PI * 18;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <h2 className="font-display text-[21px] font-bold tracking-[-0.025em]">{t("archive")}</h2>
        <div className="flex items-center gap-1">
          <MonthNavButton icon="chevron_left" label={t("previousMonth")} disabled={month <= oldestMonth} onClick={() => goToMonth(shiftMonth(month, -1))} />
          <MonthNavButton icon="chevron_right" label={t("nextMonth")} disabled={month >= currentMonth} onClick={() => goToMonth(shiftMonth(month, 1))} />
        </div>
      </div>

      <div className="overflow-hidden rounded-[22px] border border-border bg-card px-3 pb-3 pt-3.5 shadow-sm">
        <div className="flex items-center justify-between px-1 pb-3">
          <div className="relative min-w-0 overflow-hidden">
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <motion.div
                key={month}
                custom={direction}
                initial={{ y: direction * 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: direction * -14, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <h3 className="font-display text-lg font-bold tracking-[-0.02em]">{monthLabel}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("monthSummaryCount", { played, total: monthGames.length, hits })}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
          {/* Donut: % de acierto del mes (acertadas sobre terminadas) */}
          <div
            className="relative size-11 shrink-0"
            role="img"
            aria-label={t("monthHitRateAria", { percent: Math.round(hitRatio * 100) })}
            title={t("monthHitRateAria", { percent: Math.round(hitRatio * 100) })}
          >
            <svg width="44" height="44" className="-rotate-90" aria-hidden>
              <circle cx="22" cy="22" r="18" fill="none" strokeWidth="5" className="stroke-border" />
              <motion.circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                strokeWidth="5"
                strokeLinecap="round"
                className="stroke-brand"
                strokeDasharray={ringCircumference}
                initial={false}
                animate={{ strokeDashoffset: ringCircumference * (1 - hitRatio) }}
                transition={{ type: "spring", stiffness: 90, damping: 20 }}
              />
            </svg>
            <b aria-hidden className="absolute inset-0 grid place-items-center font-mono text-[9.5px] font-semibold tracking-[-0.04em]">
              {Math.round(hitRatio * 100)}%
            </b>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-[5px]" aria-hidden>
          {(WEEKDAY_INITIALS[locale] ?? WEEKDAY_INITIALS.es).map((label, i) => (
            <span key={i} className="pb-1.5 text-center font-mono text-[10px] font-semibold text-muted-foreground">
              {label}
            </span>
          ))}
        </div>

        <motion.div
          onPanStart={() => {
            pannedRef.current = true;
          }}
          onPanEnd={(e, info) => {
            handlePanEnd(e, info);
            // El click llega justo después del pointerup: se libera en el siguiente tick.
            setTimeout(() => {
              pannedRef.current = false;
            }, 0);
          }}
          style={{ touchAction: "pan-y" }}
        >
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.div
              key={month}
              custom={direction}
              initial={{ x: direction * 48, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: direction * -48, opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="grid grid-cols-7 gap-[5px]"
            >
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <span key={`b${i}`} aria-hidden />
              ))}
              {cells.map((cell, index) => (
                <DayCell
                  key={cell.date}
                  cell={cell}
                  index={leadingBlanks + index}
                  isSelected={cell.date === selectedDate}
                  ariaLabel={
                    cell.game || (cell.isToday && today)
                      ? `${cell.isToday ? `${t("today")}, ` : ""}${t("calendarDayAria", {
                          date: format(parseISO(cell.date), "PPP", { locale: dateFnsLocale }),
                          number: cell.game?.game_number ?? today?.gameNumber ?? 0,
                          status: statusLabel(cell.status),
                        })}`
                      : undefined
                  }
                  onSelect={() => {
                    if (pannedRef.current) return;
                    setSelected(cell.date);
                    if (cell.game) prefetchPlayRoute(cell.game.id);
                  }}
                  onPrefetch={cell.game ? () => prefetchPlayRoute(cell.game!.id) : undefined}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <ul className="flex flex-wrap gap-x-3 gap-y-1.5 px-1 pt-3 text-[11px] text-muted-foreground">
          <LegendItem swatch={<i className="size-2.5 rounded-[3px] bg-[#2bee79]" />} label={t("legendWonAttempt")} />
          <LegendItem swatch={<i className="size-2.5 rounded-[3px] bg-[#ff5d5d]" />} label={t("legendLostShort")} />
          <LegendItem swatch={<i className="size-2.5 rounded-[3px] border-[1.5px] border-dashed border-muted-foreground" />} label={t("legendPending")} />
          <LegendItem swatch={<i className="size-2.5 rounded-[3px] bg-[#ffb547]" />} label={t("legendInProgress")} />
        </ul>
      </div>

      {/* Ficha del día seleccionado */}
      <AnimatePresence mode="popLayout" initial={false}>
        {selectedCell && (selectedCell.game || selectedCell.isToday) ? (
          <motion.div
            key={selectedCell.date}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="mt-2.5"
          >
            <DayDetail
              cell={selectedCell}
              gameNumber={selectedCell.game?.game_number ?? (selectedCell.isToday ? (today?.gameNumber ?? null) : null)}
              dateLabel={format(parseISO(selectedCell.date), "EEE d MMM", { locale: dateFnsLocale }).replace(/\./g, "")}
              formatNumber={formatNumber}
              onOpen={() => (selectedCell.isToday ? onPlayToday() : openGame(selectedCell))}
              onScrollTop={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Aviso de pendientes del mes */}
      {pending.length > 0 && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => openGame([...pending].reverse()[0])}
          className="mt-2.5 flex w-full items-center gap-2.5 rounded-2xl bg-brand/10 px-3.5 py-3 text-left text-[13px] font-semibold"
        >
          <span aria-hidden className="material-symbols-outlined text-xl text-brand" style={{ fontVariationSettings: "'FILL' 1" }}>
            headphones
          </span>
          <span className="min-w-0 flex-1">{t("pendingChip", { count: pending.length, month: monthName })}</span>
          <em className="inline-flex items-center font-bold not-italic text-brand">
            {t("detailPlay")}
            <span aria-hidden className="material-symbols-outlined text-lg">chevron_right</span>
          </em>
        </motion.button>
      )}
    </section>
  );
}

function DayCell({
  cell,
  index,
  isSelected,
  ariaLabel,
  onSelect,
  onPrefetch,
}: {
  cell: { date: string; dayNum: number; status: CellStatus; isToday?: boolean; derived?: DerivedHomeDayState };
  index: number;
  isSelected: boolean;
  ariaLabel?: string;
  onSelect: () => void;
  onPrefetch?: () => void;
}) {
  const { status, derived, isToday } = cell;
  const style = { animationDelay: `${Math.min(index, 40) * 12}ms` };
  const base =
    "animate-in fade-in-0 zoom-in-75 fill-mode-both duration-300 relative grid aspect-square place-items-center overflow-hidden rounded-[11px] font-mono text-xs font-semibold";

  if (status === "future" || status === "empty") {
    return (
      <span aria-hidden style={style} className={cn(base, "text-muted-foreground", status === "future" ? "opacity-35" : "opacity-50")}>
        {cell.dayNum}
      </span>
    );
  }

  const attempt = status === "won" ? attemptFromScore(derived?.displayScore) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      style={style}
      className={cn(
        base,
        "border border-transparent outline-offset-2 transition-transform duration-150 active:scale-[0.94]",
        isSelected && "outline outline-2 outline-foreground",
        // Hoy se distingue por el anillo; el relleno es el de su estado, como el resto de días.
        isToday && "font-bold ring-2 ring-brand ring-offset-2 ring-offset-card",
        status === "pending" && !isToday && "border-[1.5px] border-dashed border-muted-foreground/55 bg-muted text-foreground",
        status === "pending" && isToday && "bg-brand/15 text-foreground",
        status === "playing" && "border-[1.5px] border-[#ffb547] bg-[#ffb547]/12 text-foreground",
        (status === "won" || status === "lost") && "text-white"
      )}
    >
      {(status === "won" || status === "lost") && (
        <>
          {derived?.displayCover ? (
            <Image
              src={derived.displayCover}
              alt=""
              fill
              sizes="48px"
              className={cn("object-cover", status === "lost" && "brightness-[0.55] grayscale")}
            />
          ) : (
            <span className={cn("absolute inset-0", status === "won" ? "bg-brand/70" : "bg-[#ff5d5d]/50")} />
          )}
          <span className="absolute left-1 top-[3px] text-[9.5px] [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">{cell.dayNum}</span>
          <span
            className={cn(
              "absolute bottom-[3px] right-[3px] grid h-[15px] min-w-[15px] place-items-center rounded-md px-[3px] text-[9.5px] font-bold",
              status === "won" ? "bg-[#2bee79] text-[#062414]" : "bg-[#ff5d5d] text-white"
            )}
          >
            {status === "won" ? (attempt ?? "✓") : "✕"}
          </span>
        </>
      )}
      {status !== "won" && status !== "lost" && <span className="relative z-[1]">{cell.dayNum}</span>}
      {status === "playing" && (
        <span aria-hidden className="absolute right-[5px] top-[5px] size-1.5 rounded-full bg-[#ffb547] shadow-[0_0_8px_#ffb547]" />
      )}
    </button>
  );
}

function DayDetail({
  cell,
  gameNumber,
  dateLabel,
  formatNumber,
  onOpen,
  onScrollTop,
}: {
  cell: { status: CellStatus; isToday?: boolean; derived?: DerivedHomeDayState };
  gameNumber: number | null;
  dateLabel: string;
  formatNumber: (n: number) => string;
  onOpen: () => void;
  onScrollTop: () => void;
}) {
  const t = useTranslations("home");
  const { status, derived } = cell;
  const meta = (
    <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {gameNumber != null ? `#${gameNumber} · ` : ""}
      {dateLabel}
    </p>
  );
  const goButtonBase = "inline-flex items-center gap-1 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-transform active:scale-95";

  let art: React.ReactNode;
  let body: React.ReactNode;
  let action: React.ReactNode;

  if (cell.isToday) {
    art = (
      <span className="grid size-14 place-items-center rounded-[14px] bg-brand text-primary-foreground">
        <span aria-hidden className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>today</span>
      </span>
    );
    body = (
      <>
        {meta}
        <p className="mt-0.5 text-[15px] font-bold tracking-[-0.01em]">{t("detailTodayTitle")}</p>
        <p className="text-[13px] text-muted-foreground">{t("detailTodayHint")}</p>
      </>
    );
    action = (
      <button type="button" onClick={onScrollTop} aria-label={t("detailGoUp")} className={cn(goButtonBase, "border border-border bg-muted")}>
        <span aria-hidden className="material-symbols-outlined text-lg">arrow_upward</span>
      </button>
    );
  } else if (status === "won" || status === "lost") {
    const attempt = status === "won" ? attemptFromScore(derived?.displayScore) : null;
    art = (
      <span className="relative block size-16 overflow-hidden rounded-[14px] bg-muted shadow-md">
        {derived?.displayCover ? (
          <Image src={derived.displayCover} alt="" fill sizes="56px" className={cn("object-cover", status === "lost" && "brightness-[0.6] grayscale")} />
        ) : null}
      </span>
    );
    body = (
      <>
        {meta}
        <p className="mt-0.5 truncate text-[15px] font-bold tracking-[-0.01em]">{derived?.displayTitle || "—"}</p>
        {derived?.displayArtist ? (
          <p className="truncate text-[13px] text-muted-foreground">{derived.displayArtist}</p>
        ) : null}
        <p className={cn("mt-1 inline-flex items-center gap-1 text-xs font-bold", status === "won" ? "text-brand" : "text-destructive")}>
          <span aria-hidden className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
            {status === "won" ? "check_circle" : "cancel"}
          </span>
          {status === "won" && attempt
            ? t("detailWonLine", {
                points: formatNumber(derived?.displayScore ?? 0),
                attempt,
                seconds: ATTEMPT_DURATIONS[attempt - 1],
              })
            : t("detailLostLine")}
        </p>
      </>
    );
    action = (
      <button type="button" onClick={onOpen} className={cn(goButtonBase, "border border-border bg-muted")}>
        {t("detailView")}
      </button>
    );
  } else {
    const playing = status === "playing";
    art = (
      <span className="grid size-14 place-items-center rounded-[14px] border-[1.5px] border-dashed border-muted-foreground/55 bg-muted text-muted-foreground">
        <span aria-hidden className="material-symbols-outlined text-2xl">{playing ? "pause" : "question_mark"}</span>
      </span>
    );
    body = (
      <>
        {meta}
        <p className="mt-0.5 text-[15px] font-bold tracking-[-0.01em]">{playing ? t("detailHalfway") : t("detailUndiscovered")}</p>
        <p className="text-[13px] text-muted-foreground">
          {playing ? t("detailNextAttempt", { attempt: (derived?.guesses.length ?? 0) + 1 }) : t("guessTheSong")}
        </p>
      </>
    );
    action = (
      <motion.button
        type="button"
        onClick={onOpen}
        whileTap={{ scale: 0.94 }}
        className={cn(goButtonBase, "bg-brand text-primary-foreground shadow-[0_8px_20px_-10px_var(--brand)]")}
      >
        <span aria-hidden className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
        {playing ? t("detailContinue") : t("detailPlay")}
      </motion.button>
    );
  }

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[22px] border border-border bg-card p-3 shadow-sm">
      {art}
      <div className="min-w-0">{body}</div>
      {action}
    </div>
  );
}

function MonthNavButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      whileTap={disabled ? undefined : { scale: 0.85 }}
      className="grid size-8 place-items-center rounded-[10px] border border-border bg-card text-foreground transition-opacity disabled:pointer-events-none disabled:opacity-30"
    >
      <span aria-hidden className="material-symbols-outlined text-xl">{icon}</span>
    </motion.button>
  );
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5" aria-hidden>
      {swatch}
      {label}
    </li>
  );
}

export { HomeArchive };
