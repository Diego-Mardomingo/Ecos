"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Permite letras, números, _, espacios y emojis (3-50 caracteres)
const USERNAME_REGEX = /^[\p{L}\p{N}_ \p{Extended_Pictographic}]{3,50}$/u;

export function CompleteProfileClient() {
  const t = useTranslations("profile.completeProfile");
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/profile";

  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
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
    setLoading(true);

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: trimmed }),
    });

    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      if (json.error === "username_taken") {
        setError(t("usernameTaken"));
      } else {
        setError(t("usernameInvalid"));
      }
      return;
    }

    router.push(redirectTo);
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
            disabled={loading}
            className="w-full rounded-xl py-3 font-semibold"
          >
            {loading ? "..." : t("continue")}
          </Button>
        </form>
      </div>
    </div>
  );
}
