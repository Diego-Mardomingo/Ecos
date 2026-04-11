import type { Query } from "@tanstack/react-query";

const PERSIST_PREFIXES = new Set([
  "home",
  "game",
  "game-progress",
  "ranking",
  "profile",
]);

export function shouldPersistQuery(query: Query): boolean {
  const key = query.queryKey[0];
  if (typeof key !== "string") return false;
  return PERSIST_PREFIXES.has(key);
}
