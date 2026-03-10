"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Locale error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <span className="material-symbols-outlined text-5xl text-destructive">
        error
      </span>
      <div className="text-center">
        <h2 className="text-lg font-semibold">Algo salió mal</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error.message || "Ha ocurrido un error inesperado"}
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline">
          Reintentar
        </Button>
        <Button asChild>
          <Link href="/">Ir al inicio</Link>
        </Button>
      </div>
    </div>
  );
}
