"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

export function LoginClient() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [oneTapReady, setOneTapReady] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const initializeOneTap = useCallback(async () => {
    if (!googleClientId || !window.google?.accounts?.id) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      router.push("/");
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
            router.push("/");
            router.refresh();
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
  }, [googleClientId, supabase, router]);

  useEffect(() => {
    if (oneTapReady && googleClientId) {
      initializeOneTap();
    }
  }, [oneTapReady, googleClientId, initializeOneTap]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setOneTapReady(true)}
      />
      {/* Blobs decorativos */}
      <div className="pointer-events-none absolute left-1/4 top-1/4 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/10 blur-[100px]" />
      <div className="pointer-events-none absolute right-1/4 bottom-1/3 h-48 w-48 translate-x-1/2 rounded-full bg-blue-500/10 blur-[80px]" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex w-full max-w-sm flex-col items-center gap-8"
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-brand/15 ring-1 ring-brand/30">
            <Image
              src="/ecos_icon_v2_192.png"
              alt="ECOS"
              width={80}
              height={80}
              className="object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">ECOS</h1>
          <p className="text-center text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>

        {/* Waveform decorativa */}
        <div className="flex items-end justify-center gap-[3px] opacity-40">
          {Array.from({ length: 24 }).map((_, i) => (
            <motion.div
              key={i}
              className="w-[3px] rounded-full bg-brand"
              animate={{
                height: [`${6 + Math.random() * 20}px`, `${6 + Math.random() * 20}px`],
              }}
              transition={{
                duration: 0.8 + Math.random() * 0.6,
                repeat: Infinity,
                repeatType: "reverse",
                ease: "easeInOut",
                delay: i * 0.05,
              }}
            />
          ))}
        </div>

        {/* Botón Google (fallback cuando One Tap no se muestra) */}
        <div className="w-full space-y-3">
          <motion.button
            onClick={handleGoogleSignIn}
            disabled={loading}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-4 text-sm font-semibold text-gray-900 shadow-lg transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-70"
          >
            {loading ? (
              <span className="material-symbols-outlined animate-spin text-xl text-gray-500">
                progress_activity
              </span>
            ) : (
              <GoogleIcon />
            )}
            {loading ? t("signingIn") : t("signInWithGoogle")}
          </motion.button>
        </div>
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
