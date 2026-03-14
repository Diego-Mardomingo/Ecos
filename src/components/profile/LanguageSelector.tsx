"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function LanguageSelector() {
  const t = useTranslations("profile.settings");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleLocaleChange = (newLocale: "es" | "en") => {
    if (locale === newLocale) return;
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span
        className="material-symbols-outlined text-xl text-brand"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        language
      </span>
      <span className="flex-1 text-left text-sm font-medium">
        {t("language")}
      </span>
      <div
        className={cn(
          "flex gap-1 rounded-full bg-muted p-1 transition-opacity",
          isPending && "opacity-70"
        )}
      >
        {(["es", "en"] as const).map((loc) => (
          <button
            key={loc}
            onClick={() => handleLocaleChange(loc)}
            disabled={isPending}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-all",
              locale === loc ? "bg-brand text-[#0a2015]" : "text-muted-foreground"
            )}
          >
            {loc === "es" ? "Español" : "English"}
          </button>
        ))}
      </div>
    </div>
  );
}
