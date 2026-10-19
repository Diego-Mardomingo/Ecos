"use client";

import { useTranslations } from "next-intl";
import { useCategoryRanking } from "@/lib/hooks/queries";
import type { CategoryLeaderboardEntry, CategoryRankingResponse } from "@/lib/categories/types";
import type { LeaderboardEntryRow } from "@/lib/queries/users";
import { LeaderboardPodiumAndList } from "@/components/leaderboard/LeaderboardPodiumAndList";
import { rankingDisplayName } from "@/lib/display-name";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { useCategoryRankingRealtime } from "@/lib/realtime/useCategoryRankingRealtime";

/**
 * Clasificación de una categoría: puntos de la mejor partida de cada jugador, con la racha como
 * desempate. Reutiliza el podio y la lista del ranking diario; el «aciertos» de cada fila es la
 * racha de esa partida.
 *
 * La siembra el RSC, se refresca al terminar una partida propia (`queryKeys.categories.all`) y en
 * vivo cuando termina la de cualquier otro jugador (Broadcast de Realtime, `useCategoryRankingRealtime`).
 * Se monta en el lobby o en el fin de partida, nunca a la vez: un canal por montaje.
 */

function toRow(entry: CategoryLeaderboardEntry): LeaderboardEntryRow {
  return {
    user_id: entry.user_id,
    total_points: entry.points,
    streak: entry.streak,
    global_rank: entry.rank,
    aciertos: entry.streak,
    profiles: { display_name: entry.display_name, avatar_url: entry.avatar_url ?? "" },
  };
}

export function CategoryRanking({
  slug,
  userId,
  initialData,
  id,
}: {
  slug: string;
  userId: string;
  initialData: CategoryRankingResponse;
  id?: string;
}) {
  const t = useTranslations("categories");
  const tr = useTranslations("ranking");
  const { formatNumber } = useAppFormatters();
  const { data } = useCategoryRanking(slug, userId, initialData);
  useCategoryRankingRealtime(slug);
  const entries = (data?.entries ?? []).map(toRow);
  const me = data?.me ?? null;

  return (
    <section id={id} className="scroll-mt-20" aria-labelledby={`${id ?? slug}-title`}>
      <h2
        id={`${id ?? slug}-title`}
        className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand"
      >
        {t("rankingTitle")}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("rankingHint")}</p>

      {me ? (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand/10 px-3.5 py-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-black tabular-nums text-primary-foreground">
            {me.rank}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-muted-foreground">
              {tr("yourPosition")}
            </span>
            <span className="block truncate text-sm font-bold">
              {formatNumber(me.points)} {tr("totalPointsShort")}
              <span className="px-1.5 font-normal text-muted-foreground">·</span>
              <span className="font-medium text-muted-foreground">
                {tr("hitsPodiumLine", { count: me.streak })}
              </span>
            </span>
          </span>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <span
              aria-hidden
              className="material-symbols-outlined text-3xl text-muted-foreground"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              emoji_events
            </span>
          </span>
          <p className="text-sm font-medium text-muted-foreground">{t("rankingEmpty")}</p>
        </div>
      ) : (
        <LeaderboardPodiumAndList
          entries={entries}
          currentUserId={data?.currentUserId ?? userId}
          formatPoints={formatNumber}
          getDisplayName={(entry) =>
            rankingDisplayName(entry.profiles?.display_name, tr("playerFallback"))
          }
          t={tr}
        />
      )}
    </section>
  );
}
