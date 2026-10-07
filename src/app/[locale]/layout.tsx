import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { MotionProvider } from "@/components/providers/MotionProvider";
import { SerwistProvider } from "../serwist";
import { Toaster } from "@/components/ui/sonner";
import "../globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

/** Titulares y cifras grandes (`font-display`). */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700", "800"],
  display: "swap",
});

/** Fechas, contadores y segundos (`font-mono`). */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  display: "swap",
});

/**
 * Iconos (`.material-symbols-outlined`): recorte autoalojado de Material Symbols. Cómo
 * regenerarlo al usar un icono nuevo, en globals.css. `next/font/local` lo sirve desde
 * /_next/static con caché inmutable y lo precarga; `public/` no sirve, porque el proxy de
 * next-intl no deja pasar rutas nuevas y el precache del service worker fallaría con un 404.
 * Sin fuente de respaldo ajustada: un nombre de icono escrito con otra fuente no se parece en nada.
 */
const materialSymbols = localFont({
  src: "../fonts/material-symbols-outlined.woff2",
  variable: "--font-material-symbols",
  weight: "400 700",
  style: "normal",
  display: "block",
  adjustFontFallback: false,
});

/**
 * `generateMetadata` en lugar de un objeto estatico: la descripcion y el OpenGraph estaban
 * hardcodeados en español, asi que los enlaces compartidos desde /en salian en español.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    metadataBase: getSiteUrl(),
    title: {
      // Lo que ven las páginas sin título propio (home, partida, login).
      default: t("title"),
      template: "ECOS - %s",
    },
    description: t("description"),
    // favicon.ico, icon0.svg, icon1.png, apple-icon.png en src/app/ son recogidos por Next.js
    // manifest.json en src/app/ es recogido automáticamente por Next.js App Router
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      // Genera: <meta name="apple-mobile-web-app-title" content="ECOS" />
      title: "ECOS",
    },
    openGraph: {
      title: "ECOS",
      description: t("ogDescription"),
      type: "website",
      siteName: "ECOS",
      // Open Graph pide idioma_TERRITORIO; con el código a secas («es») no lo reconoce.
      locale: locale === "en" ? "en_US" : "es_ES",
      alternateLocale: locale === "en" ? "es_ES" : "en_US",
    },
    // Con la imagen de `opengraph-image.tsx`: sin esto la tarjeta sale pequeña, sin imagen grande.
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sin maximumScale ni userScalable: bloquear el zoom incumple WCAG 1.4.4 y en movil impide
  // acercarse a la lista de resultados o al historico. Se quito a proposito, no por descuido.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1112" },
  ],
};

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as "es" | "en")) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {/* Iconos para iOS: Safari ignora el manifest y usa solo apple-touch-icon */}
        <link
          rel="apple-touch-icon"
          href="/web-app-manifest-192x192.png"
          sizes="192x192"
        />
        <link
          rel="apple-touch-icon"
          href="/web-app-manifest-512x512.png"
          sizes="512x512"
        />
      </head>
      <body
        className={`${dmSans.variable} ${bricolage.variable} ${jetbrainsMono.variable} ${materialSymbols.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          {/*
            Sin las dos opciones que Serwist trae activadas por defecto:
            - cacheOnNavigation: en cada navegación en cliente el SW volvía a pedir el HTML
              completo de la página destino (otro render en el servidor) para guardarlo.
            - reloadOnOnline: al recuperar la red recargaba la página entera, partida incluida.
              La reconexión ya la cubren el onlineManager de QueryProvider y OfflineBanner.
          */}
          <SerwistProvider swUrl="/serwist/sw.js" cacheOnNavigation={false} reloadOnOnline={false}>
            <MotionProvider>
              <NextIntlClientProvider messages={messages}>
                {children}
              </NextIntlClientProvider>
              <Toaster position="top-center" richColors />
            </MotionProvider>
          </SerwistProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
