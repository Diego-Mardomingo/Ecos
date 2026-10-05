"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useUpdateProfileMutation } from "@/lib/hooks/queries";
import { localizedPath, safeRelativeInternalPath } from "@/lib/i18n/localizedPath";

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

// Permite letras, números, _, espacios y emojis (3-50 caracteres)
const USERNAME_REGEX = /^[\p{L}\p{N}_ \p{Extended_Pictographic}]{3,50}$/u;

export function CompleteProfileClient() {
  const t = useTranslations("profile.completeProfile");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const defaultDest = localizedPath(locale, "/profile");
  const redirectTo = safeRelativeInternalPath(
    searchParams.get("redirect"),
    defaultDest
  );
  const updateProfile = useUpdateProfileMutation();

  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setError(t("usernameInvalid"));
      return;
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      setError(t("usernameInvalid"));
      return;
    }

    setError(null);

    updateProfile.mutate(
      { username: trimmed },
      {
        onSuccess: () => {
          /* Navegación completa: evita RSC/prefetch del App Router y caché del SW con datos previos al PATCH. */
          window.location.assign(redirectTo);
        },
        onError: (err) => {
          if (err instanceof Error && err.message === "username_taken") {
            setError(t("usernameTaken"));
          } else {
            setError(t("usernameInvalid"));
          }
        },
      }
    );
  };

  const looksValid = USERNAME_REGEX.test(username.trim());

  return (
    <div className="relative flex min-h-[calc(100dvh-6rem)] flex-col items-center justify-center overflow-hidden px-6 pb-28 pt-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="ecos-drift-a absolute -left-24 top-10 size-72 rounded-full bg-brand/15 blur-3xl" />
        <div className="ecos-drift-b absolute -right-24 bottom-24 size-64 rounded-full bg-sky-400/15 blur-3xl" />
      </div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
        className="w-full max-w-sm text-center"
      >
        <motion.div
          variants={{
            hidden: { scale: 0.6, opacity: 0, rotate: -12 },
            show: { scale: 1, opacity: 1, rotate: 0, transition: { type: "spring", stiffness: 300, damping: 18 } },
          }}
          className="mx-auto mb-6 flex size-20 items-center justify-center overflow-hidden rounded-3xl bg-brand/15 ring-1 ring-brand/30"
        >
          <Image src="/ecos_icon_v2_192.png" alt="" width={80} height={80} className="object-contain" />
        </motion.div>
        <motion.h1 variants={rise} className="text-[28px] font-bold leading-tight tracking-tight">
          {t("title")}
        </motion.h1>
        <motion.p variants={rise} className="mt-2 text-sm text-muted-foreground">
          {t("subtitle")}
        </motion.p>

        <motion.form variants={rise} onSubmit={handleSubmit} className="mt-8 space-y-3 text-left">
          <label htmlFor={inputId} className="sr-only">
            {t("username")}
          </label>
          <div className="relative">
            <span aria-hidden className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl text-muted-foreground">
              alternate_email
            </span>
            <input
              id={inputId}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              placeholder={t("placeholder")}
              maxLength={50}
              autoFocus
              aria-invalid={error ? true : undefined}
              className="h-14 w-full rounded-2xl border border-border bg-card pl-12 pr-12 text-base shadow-sm outline-none transition-[border-color,box-shadow] focus:border-brand/60 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand)_14%,transparent)]"
            />
            <AnimatePresence>
              {looksValid && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 24 }}
                  aria-hidden
                  className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-xl text-brand"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
            {error ? (
              <motion.p
                key="error"
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="px-1 text-sm font-medium text-destructive"
              >
                {error}
              </motion.p>
            ) : (
              <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-1 text-xs text-muted-foreground">
                {t("usernameInvalid")}
              </motion.p>
            )}
          </AnimatePresence>
          <motion.button
            type="submit"
            disabled={updateProfile.isPending}
            whileTap={{ scale: 0.97 }}
            className="ecos-shimmer mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-bold text-primary-foreground shadow-[0_14px_36px_-14px_var(--brand)] disabled:opacity-60"
          >
            {updateProfile.isPending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
            {t("continue")}
            {!updateProfile.isPending && (
              <span aria-hidden className="material-symbols-outlined text-xl">arrow_forward</span>
            )}
          </motion.button>
        </motion.form>
      </motion.div>
    </div>
  );
}
