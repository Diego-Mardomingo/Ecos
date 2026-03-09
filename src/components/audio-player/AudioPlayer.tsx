"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { createYoutubePlayer, type YTPlayer } from "@/lib/youtube-player";

interface AudioPlayerProps {
  youtubeId: string;
  maxDuration: number; // segundos máximos para este intento
  onEnded?: () => void;
  className?: string;
}

export function AudioPlayer({
  youtubeId,
  maxDuration,
  onEnded,
  className,
}: AudioPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!youtubeId) return;

    setIsLoaded(false);
    setCurrentTime(0);
    setIsPlaying(false);

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
  }, [youtubeId]);

  const stopAndReset = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.stopVideo();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player || !isLoaded) return;

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
  }, [isPlaying, isLoaded, maxDuration, stopAndReset, onEnded]);

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
