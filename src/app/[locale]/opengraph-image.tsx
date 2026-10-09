import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/**
 * Imagen al compartir cualquier enlace de la app (también `/play/<id>`). Es la misma para todo el
 * mundo y no lleva canción, artista ni carátula: el enlace de un reto sin resolver no puede
 * revelar nada. Se genera en el build, una por idioma.
 */
export const alt = "ecos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Barras del logo (`public/ecos_icon_v2.png`): alto sobre 1024 y color. */
const BARS = [
  { h: 116, c: "#1e7141" },
  { h: 164, c: "#208649" },
  { h: 232, c: "#22a455" },
  { h: 328, c: "#24b45e" },
  { h: 464, c: "#27d36d" },
  { h: 636, c: "#2bef79" },
  { h: 394, c: "#196339" },
  { h: 216, c: "#154227" },
];

const BRAND = "#2bee79";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/** Parte `heroTitleNew` ("Un segundo <em>basta.</em>") en texto normal y texto resaltado. */
function splitTitle(raw: string) {
  const match = raw.match(/^(.*?)<em>(.*?)<\/em>(.*)$/);
  return match
    ? { plain: `${match[1]}`.trim(), accent: match[2] }
    : { plain: raw, accent: "" };
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, font] = await Promise.all([
    getTranslations({ locale, namespace: "home" }),
    readFile(join(process.cwd(), "src/app/assets/BricolageGrotesque-800.ttf")),
  ]);
  const { plain, accent } = splitTitle(t.raw("heroTitleNew") as string);

  const scale = 220 / 636;

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
          background: "#0f1112",
          color: "#f6f8f7",
          fontFamily: "Bricolage",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, height: 220 }}>
          {BARS.map((bar, i) => (
            <div
              key={i}
              style={{
                width: 24,
                height: Math.round(bar.h * scale),
                borderRadius: 12,
                background: bar.c,
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 120, fontWeight: 800, lineHeight: 1, marginTop: 28, color: BRAND }}>
          ecos
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: 64,
            fontWeight: 800,
            marginTop: 56,
            letterSpacing: -1,
          }}
        >
          <span>{plain}</span>
          {accent && <span style={{ color: BRAND }}>{accent}</span>}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Bricolage", data: font, weight: 800, style: "normal" }],
    }
  );
}
