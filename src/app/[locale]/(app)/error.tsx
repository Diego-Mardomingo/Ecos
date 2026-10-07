"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { StatusScreen, statusPrimaryButtonClass } from "@/components/ui/status-screen";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    // Genérico y sin `error.message`: mismo criterio que en [locale]/error.tsx. Sin altura de
    // ventana completa: aquí se pinta dentro del layout, con la navegación alrededor.
    <StatusScreen
      icon="priority_high"
      tone="danger"
      title={t("error")}
      description={t("unexpectedError")}
      fullHeight={false}
    >
      <button type="button" onClick={reset} className={statusPrimaryButtonClass}>
        <span aria-hidden className="material-symbols-outlined text-xl">refresh</span>
        {t("retry")}
      </button>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground/70">
          {t("errorReference")}: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
    </StatusScreen>
  );
}
