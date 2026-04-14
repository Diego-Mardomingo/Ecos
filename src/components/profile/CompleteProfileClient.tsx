"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useUpdateProfileMutation } from "@/lib/hooks/queries";
import { localizedPath, safeRelativeInternalPath } from "@/lib/i18n/localizedPath";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 pt-6 pb-28">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
            placeholder={t("placeholder")}
            maxLength={50}
            className="text-center"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            disabled={updateProfile.isPending}
            className="w-full rounded-xl py-3 font-semibold"
          >
            {updateProfile.isPending ? "..." : t("continue")}
          </Button>
        </form>
      </div>
    </div>
  );
}
