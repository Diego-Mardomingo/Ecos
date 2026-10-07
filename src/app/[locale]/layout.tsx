import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
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
    // Base de las URL relativas de los metadatos (og:image, canonical…). La variable permite
    // apuntar a otro dominio sin tocar código; sin ella, el de producción.
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ecosgame.vercel.app"),
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
        {/* Fuente de iconos autoalojada (ver globals.css): todas las páginas la usan desde el
            primer pintado, así que se pide en paralelo al CSS en vez de esperar a descubrirla. */}
        <link
          rel="preload"
          href="/fonts/material-symbols-outlined-d8bbd45b.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
      </head>
      <body
        className={`${dmSans.variable} ${bricolage.variable} ${jetbrainsMono.variable} font-sans antialiased`}
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
