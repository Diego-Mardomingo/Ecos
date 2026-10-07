"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { motion, type Variants } from "framer-motion";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  LOGIN_REDIRECT_COOKIE,
  LOGIN_REDIRECT_COOKIE_PATH,
} from "@/lib/auth/safeRedirectPath";
import { WaveformBars } from "@/components/home/HomeWaveform";

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

/** Los tres puntos que resumen el juego bajo el título. */
const FEATURES = [
  { key: "featureDaily", icon: "calendar_month", iconClass: "bg-brand/15 text-brand" },
  { key: "featureClip", icon: "graphic_eq", iconClass: "bg-sky-500/15 text-sky-500" },
  { key: "featureRanking", icon: "trophy", iconClass: "bg-amber-500/15 text-amber-500" },
] as const;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            use_fedcm_for_prompt?: boolean;
          }) => void;
          prompt: () => void;
        };
      };
    };
  }
}

/**
 * Guarda el destino post-login para el callback de OAuth. Solo viaja a `/api/auth/callback` y
 * caduca en 10 minutos, que sobra para ir a Google y volver.
 */
function rememberLoginRedirect(target: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${LOGIN_REDIRECT_COOKIE}=${encodeURIComponent(target)}; Path=${LOGIN_REDIRECT_COOKIE_PATH}` +
    `; Max-Age=600; SameSite=Lax${secure}`;
}

type LoginClientProps = {
  /** Destino tras entrar, ya saneado en el servidor (`getSafeRedirectTarget`). */
  redirectTo: string;
};

export function LoginClient({ redirectTo }: LoginClientProps) {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [oneTapReady, setOneTapReady] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  // Requiere que el origen actual (ej. http://localhost:3000) esté en "Authorized JavaScript origins" del OAuth client en Google Cloud Console
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const initializeOneTap = useCallback(async () => {
    if (!googleClientId || !window.google?.accounts?.id) return;

    // getUser() y no getSession(): si la sesión se cerró en el servidor pero el navegador aún
    // guarda las cookies, getSession() la daría por buena y mandaría a un destino protegido que
    // devolvería aquí, en bucle.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      // `redirectTo` ya lleva el prefijo de locale: por eso el router de next/navigation y no
      // el de next-intl, que se lo volvería a poner.
      router.push(redirectTo);
      return;
    }

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response: { credential: string }) => {
        setLoading(true);
        try {
          const { error } = await supabase.auth.signInWithIdToken({
            provider: "google",
            token: response.credential,
          });
          if (!error) {
            // Recarga completa de esta misma página (conserva `?redirect=`): el servidor ya ve la
            // sesión y redirige al destino.
            window.location.reload();
          } else {
            throw error;
          }
        } catch {
          setLoading(false);
        }
      },
      use_fedcm_for_prompt: true,
    });
    window.google.accounts.id.prompt();
  }, [googleClientId, supabase, router, redirectTo]);

  useEffect(() => {
    if (oneTapReady && googleClientId) {
      initializeOneTap();
    }
  }, [oneTapReady, googleClientId, initializeOneTap]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    rememberLoginRedirect(redirectTo);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
  };

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setOneTapReady(true)}
      />

      {/* Fondo: manchas a la deriva y un ecualizador grande al pie. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="ecos-drift-a absolute -left-24 -top-24 size-80 rounded-full bg-brand/20 blur-3xl" />
        <div className="ecos-drift-b absolute -right-24 top-1/3 size-72 rounded-full bg-sky-400/15 blur-3xl" />
        <div className="absolute inset-x-0 bottom-0 h-40 opacity-30 [mask-image:linear-gradient(to_top,black,transparent)]">
          <WaveformBars />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-sm items-center">
        <button
          type="button"
          onClick={() => router.back()}
          className="group flex size-10 items-center justify-center rounded-full border border-border bg-card/70 backdrop-blur transition-[transform,border-color] hover:border-brand/40 active:scale-90"
          aria-label={tCommon("back")}
        >
          <span aria-hidden className="material-symbols-outlined text-xl transition-transform group-hover:-translate-x-0.5">
            arrow_back
          </span>
        </button>
      </div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}
        className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center"
      >
        <motion.div
          variants={{
            hidden: { scale: 0.5, opacity: 0, rotate: -15 },
            show: { scale: 1, opacity: 1, rotate: 0, transition: { type: "spring", stiffness: 280, damping: 16 } },
          }}
          className="relative mb-6 size-20"
        >
          <span aria-hidden className="ecos-ping absolute inset-0 rounded-[26px] bg-brand/25 [animation-duration:2.8s]" />
          <span className="relative flex size-full items-center justify-center overflow-hidden rounded-[26px] bg-brand/15 shadow-[0_16px_40px_-14px_var(--brand)] ring-1 ring-brand/30">
            <Image src="/ecos_icon_v2_192.png" alt="ECOS" width={80} height={80} className="object-contain" priority />
          </span>
        </motion.div>

        <motion.h1 variants={rise} className="text-[34px] font-bold leading-[1.1] tracking-tight">
          {t("welcome")}
        </motion.h1>
        <motion.p variants={rise} className="mt-3 text-base leading-relaxed text-muted-foreground">
          {t("subtitle")}
        </motion.p>

        <ul className="mt-8 space-y-3">
          {FEATURES.map((feature) => (
            <motion.li key={feature.key} variants={rise} className="flex items-center gap-3">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-2xl", feature.iconClass)}>
                <span aria-hidden className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {feature.icon}
                </span>
              </span>
              <span className="text-sm font-medium">{t(feature.key)}</span>
            </motion.li>
          ))}
        </ul>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto w-full max-w-sm space-y-3 pt-8"
      >
        {/* Botón Google (fallback cuando One Tap no se muestra) */}
        <motion.button
          onClick={handleGoogleSignIn}
          disabled={loading}
          whileTap={{ scale: 0.97 }}
          className="ecos-shimmer flex h-14 w-full items-center justify-center gap-3 rounded-full bg-white text-[15px] font-semibold text-gray-900 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5 transition-colors hover:bg-gray-50 disabled:opacity-70"
        >
          {loading ? (
            <span aria-hidden className="material-symbols-outlined animate-spin text-xl text-gray-500">
              progress_activity
            </span>
          ) : (
            <GoogleIcon />
          )}
          {loading ? t("signingIn") : t("signInWithGoogle")}
        </motion.button>
        <Link
          href="/"
          className="flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("continueAsGuest")}
        </Link>
      </motion.div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
