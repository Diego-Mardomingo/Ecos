import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
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
    title: {
      default: "ECOS",
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
      locale,
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
      </head>
      <body
        className={`${dmSans.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          <SerwistProvider swUrl="/serwist/sw.js">
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
