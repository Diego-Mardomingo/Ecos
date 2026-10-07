"use client";

import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { cn } from "@/lib/utils";
import { avatarInitials } from "@/lib/display-name";
import type { LeaderboardEntryRow as LeaderboardEntry } from "@/lib/queries/users";

/**
 * Podio (los tres primeros) y lista del resto de una clasificación. Lo usan el ranking en vivo y
 * el detalle de un periodo del histórico.
 *
 * El podio ya enseña a los tres primeros, así que la lista empieza en el cuarto: antes se
 * repetían los tres arriba y abajo.
 *
 * Las entradas van en CSS y no en framer-motion: con framer, el podio y las filas llegaban con
 * `opacity:0` en el HTML del servidor y no se veían hasta hidratar (PERF-04).
 */

const EASE_OUT = "[--tw-ease:cubic-bezier(0.22,1,0.36,1)]";

type RankingT = {
  (key: string): string;
  (key: string, values?: Record<string, string | number | Date>): string;
};

/** Id del DOM de la fila de un usuario, para poder desplazarse hasta ella. */
export function leaderboardRowId(userId: string) {
  return `leaderboard-row-${userId}`;
}

const MEDALS = {
  1: {
    ring: "ring-amber-400",
    text: "text-amber-500 dark:text-amber-400",
    pedestal: "from-amber-400/90 to-amber-400/25",
    glow: "shadow-[0_0_32px_-6px_rgba(251,191,36,0.7)]",
  },
  2: {
    ring: "ring-zinc-300 dark:ring-zinc-400",
    text: "text-zinc-500 dark:text-zinc-300",
    pedestal: "from-zinc-300/90 to-zinc-300/20 dark:from-zinc-400/80 dark:to-zinc-400/15",
    glow: "",
  },
  3: {
    ring: "ring-bronze",
    text: "text-bronze",
    pedestal: "from-bronze/85 to-bronze/20",
    glow: "",
  },
} as const;

/** Altura del pedestal y retardo de entrada: el tercero sube primero y el ganador el último. */
const PODIUM_LAYOUT = {
  1: { height: "h-24", delay: 0.3, avatar: "size-[72px]" },
  2: { height: "h-[72px]", delay: 0.15, avatar: "size-14" },
  3: { height: "h-14", delay: 0.05, avatar: "size-14" },
} as const;

export function LeaderboardPodiumAndList({
  entries,
  currentUserId,
  formatPoints,
  getDisplayName,
  t,
}: {
  entries: LeaderboardEntry[];
  currentUserId: string | null;
  formatPoints: (n: number) => string;
  getDisplayName: (entry: LeaderboardEntry) => string;
  t: RankingT;
}) {
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <>
      <div className="grid grid-cols-3 items-end gap-2 px-1 pb-2 pt-8">
        {([2, 1, 3] as const).map((position) => (
          <PodiumColumn
            key={position}
            entry={top3[position - 1]}
            position={position}
            isCurrentUser={!!currentUserId && top3[position - 1]?.user_id === currentUserId}
            formatPoints={formatPoints}
            getDisplayName={getDisplayName}
            t={t}
          />
        ))}
      </div>

      {rest.length > 0 && (
        <ol className="mt-4 flex flex-col gap-2 pb-4">
          {rest.map((entry, i) => {
            const isMe = entry.user_id === currentUserId;
            const name = isMe ? t("youLabel") : getDisplayName(entry);
            return (
              <li
                key={entry.user_id}
                id={leaderboardRowId(entry.user_id)}
                // Tope al escalonado: con 50 filas, las últimas tardarían 2 s en aparecer.
                style={{ animationDelay: `${350 + Math.min(i, 12) * 35}ms` }}
                className={cn(
                  "flex scroll-mt-28 items-center gap-3 rounded-2xl border px-3 py-2.5",
                  "animate-in fade-in slide-in-from-bottom-3 animation-duration-400 fill-mode-backwards",
                  EASE_OUT,
                  isMe ? "border-brand/40 bg-brand/10 ring-1 ring-brand/20" : "border-border bg-card"
                )}
              >
                <span
                  className={cn(
                    "w-8 shrink-0 text-center text-sm font-bold tabular-nums",
                    isMe ? "text-brand" : "text-muted-foreground"
                  )}
                >
                  {entry.global_rank ?? i + 4}
                </span>
                <Avatar className="size-10 shrink-0 ring-1 ring-border">
                  <AvatarImage src={entry.profiles?.avatar_url} />
                  <AvatarFallback className="bg-muted text-xs font-bold">
                    {avatarInitials(getDisplayName(entry))}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className={cn("flex items-center gap-1.5 truncate text-sm font-semibold", isMe && "text-brand")}>
                    <span className="truncate">{name}</span>
                    <SupporterBadge label={t("earlySupporterBadge")} />
                  </p>
                  <p className="text-xs text-muted-foreground">{t("hitsPodiumLine", { count: entry.aciertos })}</p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums">{formatPoints(entry.total_points)}</span>
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("totalPointsShort")}
                  </span>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function PodiumColumn({
  entry,
  position,
  isCurrentUser,
  formatPoints,
  getDisplayName,
  t,
}: {
  entry: LeaderboardEntry | undefined;
  position: 1 | 2 | 3;
  isCurrentUser: boolean;
  formatPoints: (n: number) => string;
  getDisplayName: (e: LeaderboardEntry) => string;
  t: RankingT;
}) {
  const medal = MEDALS[position];
  const layout = PODIUM_LAYOUT[position];
  if (!entry) return <div aria-hidden />;

  const name = isCurrentUser ? t("youLabel") : getDisplayName(entry);

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div
        className="relative mb-2 flex animate-in flex-col items-center fade-in slide-in-from-bottom-4 zoom-in-80 animation-duration-600 [--tw-ease:cubic-bezier(0.34,1.56,0.64,1)] fill-mode-backwards"
        style={{ animationDelay: `${(layout.delay + 0.25) * 1000}ms` }}
      >
        {position === 1 && (
          <motion.span
            aria-hidden
            animate={{ y: [0, -4, 0], rotate: [-6, 6, -6] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-7 text-2xl drop-shadow"
          >
            👑
          </motion.span>
        )}
        <Avatar className={cn("ring-[3px] ring-offset-2 ring-offset-background", layout.avatar, medal.ring, medal.glow)}>
          <AvatarImage src={entry.profiles?.avatar_url} />
          <AvatarFallback className="bg-muted font-bold">
            {avatarInitials(getDisplayName(entry))}
          </AvatarFallback>
        </Avatar>
        <p className={cn("mt-2 flex max-w-full items-center gap-1 px-1 text-xs font-semibold", isCurrentUser && "text-brand")}>
          <span className="truncate">{name}</span>
          <SupporterBadge label={t("earlySupporterBadge")} />
        </p>
        <p className={cn("text-sm font-bold tabular-nums", medal.text)}>
          <AnimatedNumber value={entry.total_points} format={formatPoints} delay={layout.delay + 0.3} duration={0.8} />
        </p>
        <p className="text-[10px] text-muted-foreground">{t("hitsPodiumLine", { count: entry.aciertos })}</p>
      </div>
      {/* El pedestal crece en vertical desde `scaleY(0)`: no hay keyframes de `tw-animate-css` para
          escalar un solo eje, así que va con una transición desde `@starting-style`. Donde no se
          soporte, aparece ya crecido. */}
      <div
        className={cn(
          "flex w-full origin-bottom items-start justify-center rounded-t-2xl bg-gradient-to-b pt-2",
          "transition-[scale] duration-600 starting:scale-y-0",
          EASE_OUT,
          layout.height,
          medal.pedestal
        )}
        style={{ transitionDelay: `${layout.delay * 1000}ms` }}
      >
        <span className="text-2xl font-black text-white/90 drop-shadow-sm">{position}</span>
      </div>
    </div>
  );
}

/** Insignia de «Primeros en apoyar». */
function SupporterBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-500"
      title={label}
      aria-label={label}
      role="img"
    >
      <span aria-hidden className="material-symbols-outlined text-[10px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
        volunteer_activism
      </span>
    </span>
  );
}
