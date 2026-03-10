"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

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
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6">
      <span className="material-symbols-outlined text-5xl text-destructive">
        error
      </span>
      <div className="text-center">
        <h2 className="text-lg font-semibold">{t("error")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error.message || "Ha ocurrido un error inesperado"}
        </p>
      </div>
      <Button onClick={reset} variant="outline">
        {t("retry")}
      </Button>
    </div>
  );
}
