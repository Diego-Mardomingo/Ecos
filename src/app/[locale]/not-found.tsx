import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { StatusScreen, statusPrimaryButtonClass } from "@/components/ui/status-screen";

/**
 * 404 dentro de un idioma válido. Es el que recoge los `notFound()` de la app: día de juego
 * inexistente o futuro (`play/[gameId]`) y las páginas de admin cuando `requireAdminPage()`
 * deniega el acceso —ahí el 404 es intencionado, para no confirmar que la ruta existe—.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("common");

  return (
    <StatusScreen icon="search_off" title={t("notFoundTitle")} description={t("notFoundDescription")}>
      <Link href="/" className={statusPrimaryButtonClass}>
        <span aria-hidden className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
          home
        </span>
        {t("goHome")}
      </Link>
    </StatusScreen>
  );
}
