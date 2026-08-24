"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { format, parse, type Locale } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { Link } from "@/i18n/navigation";
import {
  LeaderboardPodiumAndList,
  type LeaderboardEntry,
} from "@/components/leaderboard/LeaderboardPodiumAndList";
import { RankingPodiumAndListSkeleton } from "@/components/skeletons";
import { useLeaderboardHistoryDetail } from "@/lib/hooks/queries";

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
  return format(a, "LLLL yyyy", { locale: dfLocale });
}

export function LeaderboardHistoryDetailClient() {
  const t = useTranslations("ranking");
  const locale = useLocale();
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

  const dfLocale = locale === "es" ? esLocale : enUS;

  const formatPoints = useMemo(
    () => (n: number) =>
      n.toLocaleString(locale === "es" ? "es-ES" : "en-US"),
    [locale]
  );

  // Sin useMemo: las deps manuales (data?.periodStart, data?.periodEnd) eran más
  // específicas que la inferida (data), y eso hacía que el compilador de React
  // descartara la optimización del componente entero. Es un cálculo de strings,
  // así que se deja que lo memoice el compilador.
  const subtitle = buildSubtitle(data?.periodStart, data?.periodEnd, granularity, dfLocale);

  const getDisplayName = (entry: LeaderboardEntry) => {
    const name = entry.profiles?.display_name?.trim();
    if (name && name.toLowerCase() !== "admin") return name;
    return t("playerFallback");
  };

  const entries = data?.entries ?? [];
  const currentUserId = data?.currentUserId ?? null;

  if (!queryEnabled) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">{t("historyInvalidLink")}</p>
        <Link
          href="/ranking/history"
          className="mt-4 text-sm font-semibold text-brand"
        >
          {t("historyBackToList")}
        </Link>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">{t("historyLoadError")}</p>
        <Link
          href="/ranking/history"
          className="mt-4 text-sm font-semibold text-brand"
        >
          {t("historyBackToList")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col min-h-[calc(100dvh-5rem)]">
      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-2 py-3 pt-safe backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}
      >
        <Link
          href="/ranking/history"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-brand transition-opacity hover:opacity-80"
          aria-label={t("historyBack")}
        >
          <span aria-hidden className="material-symbols-outlined text-2xl">arrow_back</span>
        </Link>
        <div className="min-w-0 flex-1 pr-9 text-center">
          <h1 className="text-base font-bold leading-tight">{t("historyDetailTitle")}</h1>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col touch-pan-y min-h-[calc(100dvh-8rem)]"
        style={{ touchAction: "pan-y" }}
      >
        {isLoading ? (
          <RankingPodiumAndListSkeleton />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <span aria-hidden
              className="material-symbols-outlined mb-4 text-4xl text-muted-foreground"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              emoji_events
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
    </div>
  );
}
