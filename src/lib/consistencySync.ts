"use client";

const HOME_SYNC_SIGNAL_KEY = "ecos_home_sync_signal";
const RECENT_GAME_COMPLETED_KEY = "ecos_recent_game_completed";

function sessionSegment(userId: string | null): string {
  return userId ?? "guest";
}

export type HomeSyncEvent = "attemptSaved" | "gameCompleted";

export interface HomeSyncSignal {
  userSegment: string;
  gameId: string;
  event: HomeSyncEvent;
  at: number;
}

function safeSessionGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function safeSessionRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function markHomeSyncSignal(
  userId: string | null,
  gameId: string,
  event: HomeSyncEvent
): void {
  const payload: HomeSyncSignal = {
    userSegment: sessionSegment(userId),
    gameId,
    event,
    at: Date.now(),
  };
  safeSessionSet(HOME_SYNC_SIGNAL_KEY, JSON.stringify(payload));
}

export function consumeHomeSyncSignal(userId: string | null): HomeSyncSignal | null {
  const raw = safeSessionGet(HOME_SYNC_SIGNAL_KEY);
  if (!raw) return null;
  safeSessionRemove(HOME_SYNC_SIGNAL_KEY);

  try {
    const parsed = JSON.parse(raw) as Partial<HomeSyncSignal>;
    if (
      typeof parsed?.userSegment !== "string" ||
      typeof parsed?.gameId !== "string" ||
      (parsed?.event !== "attemptSaved" && parsed?.event !== "gameCompleted") ||
      typeof parsed?.at !== "number"
    ) {
      return null;
    }

    if (parsed.userSegment !== sessionSegment(userId)) return null;

    return {
      userSegment: parsed.userSegment,
      gameId: parsed.gameId,
      event: parsed.event,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

export function markRecentGameCompleted(userId: string | null): void {
  safeSessionSet(
    RECENT_GAME_COMPLETED_KEY,
    JSON.stringify({
      userSegment: sessionSegment(userId),
      at: Date.now(),
    })
  );
}

export function hasRecentGameCompleted(
  userId: string | null,
  windowMs: number
): boolean {
  const raw = safeSessionGet(RECENT_GAME_COMPLETED_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { userSegment?: string; at?: number };
    if (
      typeof parsed?.userSegment !== "string" ||
      typeof parsed?.at !== "number"
    ) {
      safeSessionRemove(RECENT_GAME_COMPLETED_KEY);
      return false;
    }
    if (parsed.userSegment !== sessionSegment(userId)) return false;
    return Date.now() - parsed.at <= windowMs;
  } catch {
    safeSessionRemove(RECENT_GAME_COMPLETED_KEY);
    return false;
  }
}
