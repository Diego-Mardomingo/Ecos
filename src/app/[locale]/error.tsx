"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  StatusScreen,
  statusPrimaryButtonClass,
  statusSecondaryButtonClass,
} from "@/components/ui/status-screen";

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    console.error("Locale error:", error);
  }, [error]);

  return (
    // Mensaje genérico a propósito: `error.message` viene de la excepción real y no está
    // traducido ni pensado para leerse (en producción Next lo reemplaza por un texto opaco de
    // todos modos). El detalle va al console.error de arriba; al usuario se le da el digest,
    // que es lo que permite localizar la traza en los logs.
    <StatusScreen icon="priority_high" tone="danger" title={t("error")} description={t("unexpectedError")}>
      <button type="button" onClick={reset} className={statusPrimaryButtonClass}>
        <span aria-hidden className="material-symbols-outlined text-xl">refresh</span>
        {t("retry")}
      </button>
      <Link href="/" className={statusSecondaryButtonClass}>
        {t("goHome")}
      </Link>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground/70">
          {t("errorReference")}: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
    </StatusScreen>
  );
}
