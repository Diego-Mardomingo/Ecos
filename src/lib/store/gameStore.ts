import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GamePhase = "idle" | "playing" | "won" | "lost";

export interface GuessEntry {
  text: string;
  correct: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
  attemptNumber: number;
}

export interface GameState {
  // Estado de la partida actual
  gameId: string | null;
  gameDate: string | null;
  phase: GamePhase;
  currentAttempt: number;
  maxAttempts: number;
  guesses: GuessEntry[];
  hintsUsed: number;
  maxHints: number;

  // Audio
  isPlaying: boolean;
  audioDuration: number; // segundos disponibles en este intento

  // Resultado
  finalScore: number | null;
  correctAttempt: number | null;

  // Acciones
  startGame: (gameId: string, gameDate: string) => void;
  loadProgress: (gameId: string, gameDate: string, guesses: GuessEntry[], currentAttempt: number) => void;
  addGuess: (guess: GuessEntry) => void;
  /** Quita el último intento (p. ej. si falló el guardado en servidor). */
  removeLastGuess: () => void;
  /** Deshace el último intento incorrecto/salto tras fallo de sync (restaura intento y audio). */
  revertLastGuessAfterFailedSync: () => void;
  /** Deshace acierto optimista tras fallo de sync (vuelve a playing). */
  revertWinAfterFailedSync: () => void;
  setPlaying: (playing: boolean) => void;
  useHint: () => void;
  setWon: (attempt: number, score: number) => void;
  setLost: () => void;
  resetGame: () => void;
}

// Duración en segundos del fragmento según el intento
const ATTEMPT_DURATIONS = [1, 2, 4, 8, 16, 30];

const initialState = {
  gameId: null,
  gameDate: null,
  phase: "idle" as GamePhase,
  currentAttempt: 1,
  maxAttempts: 6,
  guesses: [],
  hintsUsed: 0,
  maxHints: 2,
  isPlaying: false,
  audioDuration: ATTEMPT_DURATIONS[0],
  finalScore: null,
  correctAttempt: null,
};

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      ...initialState,

      startGame: (gameId, gameDate) =>
        set({
          ...initialState,
          gameId,
          gameDate,
          phase: "playing",
          audioDuration: ATTEMPT_DURATIONS[0],
        }),

      loadProgress: (gameId, gameDate, guesses, currentAttempt) =>
        set({
          ...initialState,
          gameId,
          gameDate,
          phase: "playing",
          guesses,
          currentAttempt,
          audioDuration: ATTEMPT_DURATIONS[currentAttempt - 1] ?? 30,
        }),

      addGuess: (guess) => {
        const { currentAttempt, maxAttempts, guesses } = get();
        const newGuesses = [...guesses, guess];
        const nextAttempt = currentAttempt + 1;

        if (guess.correct) {
          set({ guesses: newGuesses, isPlaying: false });
          return; // setWon se llama aparte
        }

        if (nextAttempt > maxAttempts) {
          set({ guesses: newGuesses, isPlaying: false });
          return; // setLost se llama aparte
        }

        set({
          guesses: newGuesses,
          currentAttempt: nextAttempt,
          audioDuration: ATTEMPT_DURATIONS[nextAttempt - 1] ?? 30,
          isPlaying: false,
        });
      },

      removeLastGuess: () => {
        const { guesses } = get();
        if (guesses.length === 0) return;
        set({
          guesses: guesses.slice(0, -1),
          isPlaying: true,
        });
      },

      revertLastGuessAfterFailedSync: () => {
        const { guesses, maxAttempts, phase } = get();
        if (guesses.length === 0) return;
        const newGuesses = guesses.slice(0, -1);
        const nextAttempt = newGuesses.length + 1;
        const ca = Math.min(nextAttempt, maxAttempts);
        set({
          guesses: newGuesses,
          phase: phase === "lost" ? "playing" : phase,
          currentAttempt: ca,
          audioDuration: ATTEMPT_DURATIONS[ca - 1] ?? 30,
          isPlaying: false,
        });
      },

      revertWinAfterFailedSync: () => {
        const { guesses, maxAttempts } = get();
        if (guesses.length === 0) return;
        const newGuesses = guesses.slice(0, -1);
        const nextAttempt = newGuesses.length + 1;
        const ca = Math.min(nextAttempt, maxAttempts);
        set({
          guesses: newGuesses,
          phase: "playing",
          finalScore: null,
          correctAttempt: null,
          currentAttempt: ca,
          audioDuration: ATTEMPT_DURATIONS[ca - 1] ?? 30,
          isPlaying: false,
        });
      },

      setPlaying: (playing) => set({ isPlaying: playing }),

      useHint: () => {
        const { hintsUsed, maxHints } = get();
        if (hintsUsed < maxHints) {
          set({ hintsUsed: hintsUsed + 1 });
        }
      },

      setWon: (attempt, score) =>
        set({
          phase: "won",
          correctAttempt: attempt,
          finalScore: score,
          isPlaying: false,
        }),

      setLost: () =>
        set({
          phase: "lost",
          isPlaying: false,
        }),

      resetGame: () => set(initialState),
    }),
    {
      name: "ecos-game-state",
      // Solo persistimos el resultado del día actual para mostrar historial
      partialize: (state) => ({
        gameId: state.gameId,
        gameDate: state.gameDate,
        phase: state.phase,
        guesses: state.guesses,
        finalScore: state.finalScore,
        correctAttempt: state.correctAttempt,
        currentAttempt: state.currentAttempt,
        hintsUsed: state.hintsUsed,
      }),
    }
  )
);

export { ATTEMPT_DURATIONS };
