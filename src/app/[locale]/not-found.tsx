import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/**
 * 404 dentro de un idioma válido. Es el que recoge los `notFound()` de la app: día de juego
 * inexistente o futuro (`play/[gameId]`) y las páginas de admin cuando `requireAdminPage()`
 * deniega el acceso —ahí el 404 es intencionado, para no confirmar que la ruta existe—.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("common");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <span aria-hidden className="material-symbols-outlined text-5xl text-muted-foreground">
        search_off
      </span>
      <div>
        <h2 className="text-lg font-semibold">{t("notFoundTitle")}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {t("notFoundDescription")}
        </p>
      </div>
      <Button asChild>
        <Link href="/">{t("goHome")}</Link>
      </Button>
    </div>
  );
}
