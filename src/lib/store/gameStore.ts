import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MAX_ATTEMPTS } from "@/lib/server-attempt";

export type GamePhase = "idle" | "playing" | "won" | "lost";

/**
 * Texto con el que se guarda un intento saltado, en `ecos_guesses.guess_text` y en el progreso
 * local. Lo escribe también `/api/skip-attempt`.
 */
export const SKIPPED_GUESS_TEXT = "skipped";

export interface GuessEntry {
  text: string;
  correct: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
  attemptNumber: number;
}

/** Estado completo de una partida, para sustituir el del store de una vez. */
export interface GameSnapshot {
  guesses: GuessEntry[];
  phase: "playing" | "won" | "lost";
  score: number | null;
  correctAttempt?: number;
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
  /**
   * Sustituye la partida por un estado conocido: el que confirma el servidor, o el anterior a
   * una jugada que no se pudo guardar (deshacer varias jugadas en cola es lo mismo que volver
   * al último estado bueno).
   */
  setSnapshot: (gameId: string, gameDate: string, snapshot: GameSnapshot) => void;
  addGuess: (guess: GuessEntry) => void;
  /** Corrige un intento ya apuntado (p. ej. los aciertos de artista/álbum que decide el servidor). */
  patchGuess: (attemptNumber: number, patch: Partial<Omit<GuessEntry, "attemptNumber">>) => void;
  setPlaying: (playing: boolean) => void;
  useHint: () => void;
  setWon: (attempt: number, score: number) => void;
  setLost: () => void;
  resetGame: () => void;
}

// Duración en segundos del fragmento según el intento
const ATTEMPT_DURATIONS = [1, 2, 4, 8, 16, 30];

function durationForAttempt(attempt: number): number {
  return ATTEMPT_DURATIONS[attempt - 1] ?? 30;
}

const initialState = {
  gameId: null,
  gameDate: null,
  phase: "idle" as GamePhase,
  currentAttempt: 1,
  maxAttempts: MAX_ATTEMPTS,
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
          audioDuration: durationForAttempt(currentAttempt),
        }),

      setSnapshot: (gameId, gameDate, snapshot) => {
        const { guesses, phase } = snapshot;
        // Igual que `addGuess`: en una partida terminada el intento actual es el último jugado;
        // en curso, el siguiente.
        const currentAttempt = Math.min(
          Math.max(phase === "playing" ? guesses.length + 1 : guesses.length, 1),
          MAX_ATTEMPTS
        );
        set({
          ...initialState,
          gameId,
          gameDate,
          phase,
          guesses,
          currentAttempt,
          audioDuration: durationForAttempt(currentAttempt),
          finalScore: phase === "won" ? snapshot.score : null,
          correctAttempt: phase === "won" ? (snapshot.correctAttempt ?? currentAttempt) : null,
        });
      },

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
          audioDuration: durationForAttempt(nextAttempt),
          isPlaying: false,
        });
      },

      patchGuess: (attemptNumber, patch) => {
        const { guesses } = get();
        const index = guesses.findIndex((g) => g.attemptNumber === attemptNumber);
        if (index < 0) return;
        const next = [...guesses];
        next[index] = { ...guesses[index], ...patch };
        set({ guesses: next });
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
