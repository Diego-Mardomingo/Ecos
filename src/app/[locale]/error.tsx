"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <span className="material-symbols-outlined text-5xl text-destructive">
        error
      </span>
      <div className="text-center">
        <h2 className="text-lg font-semibold">{t("error")}</h2>
        {/*
          Mensaje genérico a propósito: `error.message` viene de la excepción real y no está
          traducido ni pensado para leerse (en producción Next lo reemplaza por un texto opaco de
          todos modos). El detalle va al console.error de arriba; al usuario se le da el digest,
          que es lo que permite localizar la traza en los logs.
        */}
        <p className="mt-1 text-sm text-muted-foreground">
          {t("unexpectedError")}
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-muted-foreground/70">
            {t("errorReference")}: <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline">
          {t("retry")}
        </Button>
        <Button asChild>
          <Link href="/">{t("goHome")}</Link>
        </Button>
      </div>
    </div>
  );
}
