import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/**
 * Imagen al compartir cualquier enlace de la app (también `/play/<id>`). Es la misma para todo el
 * mundo y no lleva canción, artista ni carátula: el enlace de un reto sin resolver no puede
 * revelar nada. Se genera en el build, una por idioma.
 */
export const alt = "ECOS";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          background: "#0f1112",
          color: "#f6f8f7",
        }}
      >
        <div
          style={{
            fontSize: 240,
            fontWeight: 800,
            letterSpacing: 24,
            color: "#2bee79",
            lineHeight: 1,
          }}
        >
          ECOS
        </div>
        <div style={{ fontSize: 48, opacity: 0.8 }}>{t("ogDescription")}</div>
      </div>
    ),
    size
  );
}
