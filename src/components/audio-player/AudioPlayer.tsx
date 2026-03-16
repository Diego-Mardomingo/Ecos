"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { createYoutubePlayer, type YTPlayer } from "@/lib/youtube-player";

type AudioSource = "youtube" | "preview";

export interface AudioPlayerHandle {
  togglePlay: () => void;
}

interface AudioPlayerProps {
  youtubeId: string;
  previewUrl?: string; // Spotify preview MP3 (fallback si no hay YouTube)
  maxDuration: number;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onLoadedChange?: (isLoaded: boolean) => void;
  /** Cuando true, no se muestra la barra ni el botón (el padre dibuja el control grande) */
  hideControls?: boolean;
  className?: string;
}

const AudioPlayerComponent = ({
  youtubeId,
  previewUrl,
  maxDuration,
  onEnded,
  onTimeUpdate,
  onPlayingChange,
  onLoadedChange,
  hideControls = false,
  className,
}: AudioPlayerProps,
ref: React.Ref<AudioPlayerHandle>) => {
  const t = useTranslations("game");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceRef = useRef<AudioSource | null>(null);
  const maxDurationRef = useRef(maxDuration);
  maxDurationRef.current = maxDuration;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const updateMediaSessionPosition = useCallback((position: number) => {
    if (typeof navigator !== "undefined" && "mediaSession" in navigator && sourceRef.current === "preview") {
      try {
        navigator.mediaSession.setPositionState({
          duration: maxDurationRef.current,
          playbackRate: 1,
          position: Math.min(position, maxDurationRef.current),
        });
      } catch {
        // ignore
      }
    }
  }, []);

  const clearMediaSession = useCallback(() => {
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      try {
        navigator.mediaSession.setPositionState(null);
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler("seekto", null);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  useEffect(() => {
    onLoadedChange?.(isLoaded);
  }, [isLoaded, onLoadedChange]);

  const source: AudioSource | null =
    youtubeId ? "youtube" : previewUrl ? "preview" : null;

  useEffect(() => {
    if (!source) return;

    setIsLoaded(false);
    setCurrentTime(0);
    setIsPlaying(false);
    sourceRef.current = source;

    if (source === "youtube") {
      const wrapper = document.createElement("div");
      wrapper.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
      document.body.appendChild(wrapper);

      createYoutubePlayer({
        videoId: youtubeId,
        containerRef: { current: wrapper },
      })
        .then((player) => {
          playerRef.current = player;
          setIsLoaded(true);
        })
        .catch(() => {
          wrapper.remove();
        });

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (playerRef.current) {
          playerRef.current.stopVideo();
          playerRef.current.destroy();
          playerRef.current = null;
        }
        wrapper.remove();
      };
    }

    if (source === "preview" && previewUrl) {
      const audio = new Audio(previewUrl);
      audioRef.current = audio;

      const onLoaded = () => setIsLoaded(true);
      const onError = () => {
        audioRef.current = null;
      };

      const clampPreviewTime = () => {
        const max = maxDurationRef.current;
        if (audio.currentTime > max) {
          audio.currentTime = max;
          audio.pause();
          stopAndReset();
        }
      };

      const onSeeking = () => {
        const max = maxDurationRef.current;
        if (audio.currentTime > max) {
          audio.currentTime = max;
          audio.pause();
          stopAndReset();
        }
      };

      const onTimeUpdate = () => clampPreviewTime();

      audio.addEventListener("loadeddata", onLoaded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.addEventListener("seeking", onSeeking);
      audio.addEventListener("timeupdate", onTimeUpdate);
      audio.load();

      return () => {
        audio.removeEventListener("loadeddata", onLoaded);
        audio.removeEventListener("error", onError);
        audio.removeEventListener("seeking", onSeeking);
        audio.removeEventListener("timeupdate", onTimeUpdate);
        if (timerRef.current) clearInterval(timerRef.current);
        audio.pause();
        audio.src = "";
        audioRef.current = null;
        clearMediaSession();
      };
    }
  }, [youtubeId, previewUrl, source, clearMediaSession]);

  const stopAndReset = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.stopVideo();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setCurrentTime(0);
    setIsPlaying(false);
    clearMediaSession();
    onTimeUpdate?.(0);
  }, [clearMediaSession, onTimeUpdate]);

  const togglePlay = useCallback(() => {
    if (!isLoaded) return;

    if (sourceRef.current === "youtube") {
      const player = playerRef.current;
      if (!player) return;

      if (isPlaying) {
        player.stopVideo();
        stopAndReset();
        return;
      }

      player.seekTo(0, true);
      player.playVideo();
      setIsPlaying(true);

      timerRef.current = setInterval(() => {
        const seek = player.getCurrentTime();
        if (seek >= maxDuration) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          player.stopVideo();
          onTimeUpdate?.(maxDuration);
          setTimeout(() => {
            stopAndReset();
            onEnded?.();
          }, 120);
          return;
        }
        setCurrentTime(seek);
        onTimeUpdate?.(seek);
      }, 16);
      return;
    }

    if (sourceRef.current === "preview") {
      const audio = audioRef.current;
      if (!audio) return;

      if (isPlaying) {
        audio.pause();
        stopAndReset();
        return;
      }

      audio.currentTime = 0;
      audio.play();
      setIsPlaying(true);

      const onEndedNative = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        stopAndReset();
        onEnded?.();
      };
      audio.addEventListener("ended", onEndedNative, { once: true });

      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: "ECOS – Fragmento",
            artist: "",
            album: "",
          });
          updateMediaSessionPosition(0);
          navigator.mediaSession.setActionHandler("seekto", (details) => {
            const audio = audioRef.current;
            if (!audio || sourceRef.current !== "preview") return;
            const t = details.seekTime ?? details.endTime ?? 0;
            const clamped = Math.min(Math.max(0, t), maxDuration);
            audio.currentTime = clamped;
            setCurrentTime(clamped);
            onTimeUpdate?.(clamped);
            updateMediaSessionPosition(clamped);
          });
        } catch {
          // ignore
        }
      }

      timerRef.current = setInterval(() => {
        const seek = audio.currentTime;
        const clamped = Math.min(seek, maxDuration);
        if (clamped < seek) {
          audio.currentTime = clamped;
          audio.pause();
        }
        if (seek >= maxDuration) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          audio.pause();
          onTimeUpdate?.(maxDuration);
          updateMediaSessionPosition(maxDuration);
          setTimeout(() => {
            stopAndReset();
            onEnded?.();
          }, 120);
          return;
        }
        setCurrentTime(seek);
        onTimeUpdate?.(seek);
        updateMediaSessionPosition(seek);
      }, 16);
    }
  }, [isPlaying, isLoaded, maxDuration, stopAndReset, onEnded, onTimeUpdate, updateMediaSessionPosition]);

  useImperativeHandle(ref, () => ({
    togglePlay,
  }), [togglePlay]);

  if (!source) {
    return (
      <div className={cn("rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive", className)}>
        {t("noAudio")}
      </div>
    );
  }

  const progress = Math.min((currentTime / maxDuration) * 100, 100);
  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  if (hideControls) {
    return <div ref={containerRef} aria-hidden className="sr-only" />;
  }

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="w-full space-y-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span
            className={cn("font-medium", isPlaying && "text-brand animate-pulse")}
          >
            {isPlaying ? t("listening") : t("pressPlay")}
          </span>
          <span>
            {formatTime(currentTime)} / {formatTime(maxDuration)}
          </span>
        </div>
      </div>

      <motion.button
        onClick={togglePlay}
        whileTap={{ scale: 0.92 }}
        disabled={!isLoaded}
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-full transition-all",
          isLoaded
            ? "bg-brand shadow-lg shadow-brand/30 active:shadow-brand/20"
            : "bg-muted cursor-not-allowed opacity-50"
        )}
      >
        {isLoaded ? (
          <span
            className="material-symbols-outlined text-3xl text-[#0a2015]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {isPlaying ? "stop" : "play_arrow"}
          </span>
        ) : (
          <span className="material-symbols-outlined animate-spin text-2xl text-muted-foreground">
            progress_activity
          </span>
        )}
      </motion.button>
      <div ref={containerRef} aria-hidden className="sr-only" />
    </div>
  );
};

export const AudioPlayer = forwardRef(AudioPlayerComponent);
