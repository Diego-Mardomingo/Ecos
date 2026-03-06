"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Howl } from "howler";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  previewUrl: string;
  maxDuration: number; // segundos máximos para este intento
  onEnded?: () => void;
  className?: string;
}

export function AudioPlayer({
  previewUrl,
  maxDuration,
  onEnded,
  className,
}: AudioPlayerProps) {
  const howlRef = useRef<Howl | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  // Inicializar Howl
  useEffect(() => {
    setIsLoaded(false);
    setCurrentTime(0);
    setIsPlaying(false);

    const howl = new Howl({
      src: [previewUrl],
      html5: true,
      preload: true,
      onload: () => setIsLoaded(true),
      onend: () => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (timerRef.current) clearInterval(timerRef.current);
        onEnded?.();
      },
      onstop: () => {
        setIsPlaying(false);
        if (timerRef.current) clearInterval(timerRef.current);
      },
    });

    howlRef.current = howl;

    return () => {
      howl.unload();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [previewUrl, onEnded]);

  const stopAndReset = useCallback(() => {
    if (howlRef.current) {
      howlRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    const howl = howlRef.current;
    if (!howl || !isLoaded) return;

    if (isPlaying) {
      howl.stop();
      stopAndReset();
      return;
    }

    howl.seek(0);
    howl.play();
    setIsPlaying(true);

    timerRef.current = setInterval(() => {
      const seek = howl.seek() as number;
      setCurrentTime(seek);

      if (seek >= maxDuration) {
        howl.stop();
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
      {/* Barra de progreso */}
      <div className="w-full space-y-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-brand"
            style={{ width: `${progress}%` }}
            transition={{ ease: "linear", duration: 0.1 }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className={cn("font-medium", isPlaying && "text-brand animate-pulse")}>
            {isPlaying ? "Escuchando..." : "Pulsa play"}
          </span>
          <span>
            {formatTime(currentTime)} / {formatTime(maxDuration)}
          </span>
        </div>
      </div>

      {/* Botón Play */}
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
    </div>
  );
}
