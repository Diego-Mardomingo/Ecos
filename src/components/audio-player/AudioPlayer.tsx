"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { createYoutubePlayer, type YTPlayer } from "@/lib/youtube-player";

type AudioSource = "youtube" | "preview";

interface AudioPlayerProps {
  youtubeId: string;
  previewUrl?: string; // Spotify preview MP3 (fallback si no hay YouTube)
  maxDuration: number;
  onEnded?: () => void;
  className?: string;
}

export function AudioPlayer({
  youtubeId,
  previewUrl,
  maxDuration,
  onEnded,
  className,
}: AudioPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceRef = useRef<AudioSource | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

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
      audio.addEventListener("loadeddata", onLoaded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.load();

      return () => {
        audio.removeEventListener("loadeddata", onLoaded);
        audio.removeEventListener("error", onError);
        if (timerRef.current) clearInterval(timerRef.current);
        audio.pause();
        audio.src = "";
        audioRef.current = null;
      };
    }
  }, [youtubeId, previewUrl, source]);

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
  }, []);

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
        setCurrentTime(seek);
        if (seek >= maxDuration) {
          player.stopVideo();
          stopAndReset();
          onEnded?.();
        }
      }, 100);
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

      timerRef.current = setInterval(() => {
        const seek = audio.currentTime;
        setCurrentTime(seek);
        if (seek >= maxDuration) {
          audio.pause();
          stopAndReset();
          onEnded?.();
        }
      }, 100);
    }
  }, [isPlaying, isLoaded, maxDuration, stopAndReset, onEnded]);

  if (!source) {
    return (
      <div className={cn("rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive", className)}>
        No hay audio disponible para esta canción.
      </div>
    );
  }

  const progress = Math.min((currentTime / maxDuration) * 100, 100);
  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="w-full space-y-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-brand"
            style={{ width: `${progress}%` }}
            transition={{ ease: "linear", duration: 0.1 }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span
            className={cn("font-medium", isPlaying && "text-brand animate-pulse")}
          >
            {isPlaying ? "Escuchando..." : "Pulsa play"}
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
}
