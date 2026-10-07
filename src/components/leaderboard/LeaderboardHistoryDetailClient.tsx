"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { format, parse, type Locale } from "date-fns";
import { Link } from "@/i18n/navigation";
import { LeaderboardPodiumAndList } from "@/components/leaderboard/LeaderboardPodiumAndList";
import { rankingDisplayName } from "@/lib/display-name";
import type { LeaderboardEntryRow as LeaderboardEntry } from "@/lib/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { RankingPodiumAndListSkeleton } from "@/components/skeletons";
import { useLeaderboardHistoryDetail } from "@/lib/hooks/queries";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";

/** parse() exige fecha de referencia, pero con un patrón yyyy-MM-dd completo no
 *  influye en el resultado. Una constante evita el new Date() impuro en render. */
const PARSE_REFERENCE = new Date(0);

function buildSubtitle(
  periodStart: string | undefined,
  periodEnd: string | undefined,
  granularity: "weekly" | "monthly" | null,
  dfLocale: Locale
): string {
  if (!periodStart || !periodEnd || !granularity) return "";
  const a = parse(periodStart, "yyyy-MM-dd", PARSE_REFERENCE);
  const b = parse(periodEnd, "yyyy-MM-dd", PARSE_REFERENCE);
  if (granularity === "weekly") {
    return `${format(a, "d MMM", { locale: dfLocale })} – ${format(b, "d MMM yyyy", { locale: dfLocale })}`;
  }
  const month = format(a, "LLLL yyyy", { locale: dfLocale });
  return month.charAt(0).toUpperCase() + month.slice(1);
}

/** Estado sin datos (enlace inválido o error de carga), con vuelta al histórico. */
function DetailMessage({ icon, message, linkLabel }: { icon: string; message: string; linkLabel: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
        <span aria-hidden className="material-symbols-outlined text-3xl text-muted-foreground">
          {icon}
        </span>
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link
        href="/ranking/history"
        className="mt-5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-95"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

export function LeaderboardHistoryDetailClient() {
  const t = useTranslations("ranking");
  const params = useParams();
  const granularityRaw = params.granularity as string;
  const anchorRaw = params.anchor as string;

  const granularity =
    granularityRaw === "weekly" || granularityRaw === "monthly" ? granularityRaw : null;
  const anchor =
    typeof anchorRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(anchorRaw) ? anchorRaw : null;

  const queryEnabled = granularity != null && anchor != null;
  const { data, isLoading, isError } = useLeaderboardHistoryDetail(
    granularity ?? "weekly",
    anchor ?? "",
    { enabled: queryEnabled }
  );

  const { dateFnsLocale, formatNumber: formatPoints } = useAppFormatters();

  // Sin useMemo: las deps manuales (data?.periodStart, data?.periodEnd) eran más
  // específicas que la inferida (data), y eso hacía que el compilador de React
  // descartara la optimización del componente entero. Es un cálculo de strings,
  // así que se deja que lo memoice el compilador.
  const subtitle = buildSubtitle(data?.periodStart, data?.periodEnd, granularity, dateFnsLocale);

  const getDisplayName = (entry: LeaderboardEntry) =>
    rankingDisplayName(entry.profiles?.display_name, t("playerFallback"));

  const entries = data?.entries ?? [];
  const currentUserId = data?.currentUserId ?? null;

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col px-4">
      <PageHeader
        title={t("historyDetailTitle")}
        subtitle={subtitle || undefined}
        backHref="/ranking/history"
        backLabel={t("historyBack")}
      />

      {!queryEnabled ? (
        <DetailMessage icon="link_off" message={t("historyInvalidLink")} linkLabel={t("historyBackToList")} />
      ) : isError ? (
        <DetailMessage icon="cloud_off" message={t("historyLoadError")} linkLabel={t("historyBackToList")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col" style={{ touchAction: "pan-y" }}>
          {isLoading ? (
            <RankingPodiumAndListSkeleton />
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
                <span aria-hidden className="material-symbols-outlined text-3xl text-muted-foreground" style={{ fontVariationSettings: "'FILL' 1" }}>
                  emoji_events
                </span>
              </span>
              <p className="text-sm font-medium text-muted-foreground">{t("emptyPeriod")}</p>
            </div>
          ) : (
            <LeaderboardPodiumAndList
              entries={entries}
              currentUserId={currentUserId}
              formatPoints={formatPoints}
              getDisplayName={getDisplayName}
              t={t}
            />
          )}
          <div className="min-h-24 flex-shrink-0" aria-hidden />
        </div>
      )}
    </div>
  );
}
