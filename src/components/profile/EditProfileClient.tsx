"use client";

import { useId, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { localizedPath } from "@/lib/i18n/localizedPath";
import { createClient } from "@/lib/supabase/client";
import { useUpdateProfileMutation } from "@/lib/hooks/queries";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/page-header";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn } from "@/lib/utils";
import { avatarInitials } from "@/lib/display-name";
import { resizeAvatar } from "@/lib/resize-avatar";
import { USERNAME_MAX_LENGTH, USERNAME_REGEX } from "@/lib/username";

/**
 * Entradas en CSS y no en framer-motion: con framer, el HTML del servidor llegaba con todo el
 * contenido a `opacity:0` y no se veía hasta hidratar (PERF-04). Cada bloque sube después del
 * anterior, como hacía el `staggerChildren`. `prefers-reduced-motion` las anula desde `globals.css`.
 */
const RISE =
  "animate-in fade-in slide-in-from-bottom-[14px] animation-duration-450 [--tw-ease:cubic-bezier(0.22,1,0.36,1)] fill-mode-backwards";
const riseDelay = (step: number) => ({ animationDelay: `${step * 70}ms` });

interface Profile {
  id: string;
  display_name: string;
  avatar_url: string;
  username?: string | null;
  show_avatar_in_rankings: boolean;
}

interface Props {
  profile: Profile;
}

export function EditProfileClient({ profile }: Props) {
  const t = useTranslations("profile.editProfilePage");
  const tc = useTranslations("common");
  const locale = useLocale();
  const updateProfile = useUpdateProfileMutation();

  const [username, setUsername] = useState(profile.username ?? profile.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? "");
  const [showAvatarInRankings, setShowAvatarInRankings] = useState(
    profile.show_avatar_in_rankings
  );
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usernameId = useId();
  /** Subida de la foto en curso: velo con spinner sobre el avatar y guardar deshabilitado. */
  const [uploading, setUploading] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Formato no válido. Usa JPEG, PNG o WebP.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("La imagen no puede superar 2 MB.");
      return;
    }

    setError(null);
    setUploading(true);
    const supabase = createClient();
    const { blob, extension } = await resizeAvatar(file);
    const path = `${profile.id}/avatar.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, blob, { upsert: true, contentType: blob.type || file.type });
    setUploading(false);

    if (uploadError) {
      setError("Error al subir la imagen.");
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    // La ruta es siempre la misma: sin el parámetro, la CDN y el navegador enseñarían la foto anterior.
    setAvatarUrl(`${data.publicUrl}?v=${Date.now()}`);
  };

  const handleSave = () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setError(t("usernameRequired"));
      return;
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      setError(t("usernameInvalid"));
      return;
    }

    setError(null);

    updateProfile.mutate(
      {
        username: trimmed,
        avatar_url: avatarUrl || undefined,
        show_avatar_in_rankings: showAvatarInRankings,
      },
      {
        onSuccess: () => {
          window.location.assign(localizedPath(locale, "/profile"));
        },
        onError: (err) => {
          if (err instanceof Error && err.message === "username_taken") {
            setError(t("usernameTaken"));
          } else {
            setError(err instanceof Error ? err.message : "Error al guardar");
          }
        },
      }
    );
  };

  const trimmed = username.trim();
  const looksValid = USERNAME_REGEX.test(trimmed);

  return (
    <div className="flex min-h-full flex-col px-4 pb-28">
      <PageHeader title={t("title")} backHref="/profile" backLabel={tc("back")} />

      <div className="flex flex-col gap-5 pt-2">
        {/* Foto */}
        <section
          className={cn(RISE, "relative isolate flex flex-col items-center overflow-hidden rounded-[28px] border border-border bg-card px-5 py-6")}
          style={riseDelay(0)}
        >
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-24 overflow-hidden">
            <div className="ecos-drift-a absolute -left-10 -top-16 size-44 rounded-full bg-brand/20 blur-3xl" />
            <div className="ecos-drift-b absolute -right-10 -top-10 size-36 rounded-full bg-sky-400/15 blur-3xl" />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <m.button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            whileTap={{ scale: 0.95 }}
            aria-label={t("changeAvatar")}
            className="group relative rounded-full bg-gradient-to-br from-brand via-sky-400 to-violet-400 p-[3px]"
          >
            <span className="block rounded-full bg-card p-[3px]">
              <Avatar className="size-28">
                <AvatarImage src={avatarUrl} />
                <AvatarFallback className="bg-muted text-3xl font-bold">
                  {avatarInitials(username || profile.display_name)}
                </AvatarFallback>
              </Avatar>
            </span>
            {/* Velo con cámara al pasar por encima, y siempre mientras sube la foto. */}
            <span
              className={cn(
                "absolute inset-[6px] flex items-center justify-center rounded-full bg-black/45 text-white transition-opacity duration-200",
                uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
            >
              {uploading ? (
                <Loader2 className="size-7 animate-spin" aria-hidden />
              ) : (
                <span aria-hidden className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  photo_camera
                </span>
              )}
            </span>
            <span className="absolute bottom-1 right-1 flex size-9 items-center justify-center rounded-full bg-brand text-primary-foreground shadow-lg ring-4 ring-card transition-transform duration-200 group-hover:scale-110">
              <span aria-hidden className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                add_a_photo
              </span>
            </span>
          </m.button>
          <p className="mt-3 text-sm font-medium">{t("avatar")}</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            // La zona táctil sube a ≥ 44 px con un pseudo-elemento, sin cambiar el aspecto (UX-12).
            className="relative mt-1 text-sm font-semibold text-brand transition-opacity before:absolute before:-inset-x-4 before:-inset-y-3.5 before:content-[''] hover:opacity-80"
          >
            {t("changeAvatar")}
          </button>
        </section>

        {/* Nombre de usuario */}
        <section className={cn(RISE, "rounded-3xl border border-border bg-card p-4")} style={riseDelay(1)}>
          <label htmlFor={usernameId} className="mb-2 block text-sm font-semibold">
            {t("username")}
          </label>
          <div className="relative">
            <span aria-hidden className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-muted-foreground">
              alternate_email
            </span>
            <input
              id={usernameId}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              placeholder={t("usernamePlaceholder")}
              maxLength={USERNAME_MAX_LENGTH}
              aria-invalid={error ? true : undefined}
              className="h-12 w-full rounded-2xl border border-border bg-background pl-11 pr-11 text-base outline-none transition-[border-color,box-shadow] focus:border-brand/60 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand)_14%,transparent)]"
            />
            {/* `initial={false}`: con el nombre guardado ya es válido al cargar, y la entrada lo
                dejaba a escala 0 en el HTML del servidor. Sigue animando al cambiar. */}
            <AnimatePresence initial={false}>
              {looksValid && (
                <m.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 24 }}
                  aria-hidden
                  className="material-symbols-outlined absolute right-3.5 top-1/2 -translate-y-1/2 text-xl text-brand"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </m.span>
              )}
            </AnimatePresence>
          </div>
          <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
            <span>{t("usernameInvalid")}</span>
            <span className="shrink-0 tabular-nums">{username.length}/50</span>
          </div>
        </section>

        {/* Visibilidad de la foto */}
        <section className={cn(RISE, "flex items-start gap-4 rounded-3xl border border-border bg-card p-4")} style={riseDelay(2)}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug">{t("rankingsAvatarVisibility")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("rankingsAvatarVisibilityHelp")}</p>
          </div>
          <ToggleSwitch
            label={t("rankingsAvatarVisibility")}
            checked={showAvatarInRankings}
            onCheckedChange={setShowAvatarInRankings}
            className="mt-0.5"
          />
        </section>

        <AnimatePresence>
          {error && (
            <m.p
              role="alert"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              className="flex items-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              <span aria-hidden className="material-symbols-outlined text-lg">error</span>
              {error}
            </m.p>
          )}
        </AnimatePresence>

        <m.button
          type="button"
          onClick={handleSave}
          disabled={updateProfile.isPending || uploading}
          whileTap={{ scale: 0.97 }}
          className={cn(
            RISE,
            "ecos-shimmer flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-bold text-primary-foreground shadow-[0_14px_36px_-14px_var(--brand)] disabled:opacity-60"
          )}
          style={riseDelay(3)}
        >
          {updateProfile.isPending ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <span aria-hidden className="material-symbols-outlined text-xl">check</span>
          )}
          {updateProfile.isPending ? t("saving") : t("save")}
        </m.button>
      </div>
    </div>
  );
}
