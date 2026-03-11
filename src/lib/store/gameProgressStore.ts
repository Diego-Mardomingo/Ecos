import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GuessEntry } from "./gameStore";

export interface GameProgress {
  gameId: string;
  gameDate: string;
  played: boolean;
  won: boolean;
  score: number | null;
  title?: string;
  artist_name?: string;
  cover_url?: string;
  guesses: GuessEntry[];
  phase: "won" | "lost" | "playing";
  correctAttempt?: number;
}

interface GameProgressState {
  byGameId: Record<string, GameProgress>;
  saveProgress: (progress: GameProgress) => void;
  removeProgress: (gameId: string) => void;
  getProgress: (gameId: string) => GameProgress | undefined;
}

export const useGameProgressStore = create<GameProgressState>()(
  persist(
    (set, get) => ({
      byGameId: {},

      saveProgress: (progress) =>
        set((state) => ({
          byGameId: {
            ...state.byGameId,
            [progress.gameId]: progress,
          },
        })),

      removeProgress: (gameId) =>
        set((state) => {
          const { [gameId]: _, ...rest } = state.byGameId;
          return { byGameId: rest };
        }),

      getProgress: (gameId) => get().byGameId[gameId],
    }),
    {
      name: "ecos-game-progress",
      partialize: (state) => ({ byGameId: state.byGameId }),
    }
  )
);
