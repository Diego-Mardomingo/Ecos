"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

interface Profile {
  id: string;
  display_name: string;
  avatar_url: string;
  username?: string | null;
}

interface Props {
  profile: Profile;
}

export function EditProfileClient({ profile }: Props) {
  const t = useTranslations("profile.editProfilePage");
  const queryClient = useQueryClient();
  const router = useRouter();

  const [username, setUsername] = useState(profile.username ?? profile.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const supabase = createClient();
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${profile.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setError("Error al subir la imagen.");
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
  };

  const handleSave = async () => {
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
    setSaving(true);

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: trimmed,
        avatar_url: avatarUrl || undefined,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      if (json.error === "username_taken") {
        setError(t("usernameTaken"));
      } else {
        setError(json.error ?? "Error al guardar");
      }
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["profile"] });
    router.push("/profile");
  };

  return (
    <div className="flex min-h-full flex-col gap-6 px-4 pb-28">
      <header className="flex items-center gap-3 py-3">
        <Link
          href="/profile"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-muted"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </Link>
        <h1 className="text-base font-bold">{t("title")}</h1>
      </header>

      <div className="space-y-6">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm font-medium text-muted-foreground">{t("avatar")}</p>
          <div className="relative">
            <Avatar className="h-28 w-28 ring-2 ring-brand/40">
              <AvatarImage src={avatarUrl} />
              <AvatarFallback className="bg-secondary text-2xl font-bold">
                {(username || profile.display_name).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-brand shadow-md"
            >
              <span
                className="material-symbols-outlined text-base text-[#0a2015]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                add_a_photo
              </span>
            </button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            {t("changeAvatar")}
          </Button>
        </div>

        {/* Username */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("username")}</label>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("usernamePlaceholder")}
            maxLength={30}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-xl py-3 font-semibold"
        >
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
