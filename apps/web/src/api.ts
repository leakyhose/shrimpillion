import { useCallback, useEffect, useState } from "react";

/** API origin. Empty in dev (Vite proxies /api); set VITE_API_URL to the Railway URL in production. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const TOKEN_KEY = "shrimpillion-token";
/** Set when this browser just made a new player, so the set-name popup shows once. */
export const NEW_DIVER_KEY = "shrimpillion-new-diver";
/** Fired on window when the player is created or renamed. */
export const DIVER_EVENT = "shrimpillion-diver";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? "http_error", data.error?.message ?? res.statusText);
  return data as T;
}

let creating: Promise<void> | null = null;

/** Create an anonymous player on first use and keep its token in localStorage. */
function ensurePlayer(): Promise<void> {
  if (localStorage.getItem(TOKEN_KEY)) return Promise.resolve();
  creating ??= request<{ token: string }>("POST", "/api/players", {})
    .then((r) => {
      localStorage.setItem(TOKEN_KEY, r.token);
      localStorage.setItem(NEW_DIVER_KEY, "1");
      window.dispatchEvent(new Event(DIVER_EVENT));
    })
    .finally(() => (creating = null));
  return creating;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  await ensurePlayer();
  try {
    return await request<T>(method, path, body);
  } catch (e) {
    // Token unknown to the server (e.g. database reset): start over as a new player.
    if (e instanceof ApiError && e.code === "invalid_token") {
      localStorage.removeItem(TOKEN_KEY);
      await ensurePlayer();
      return request<T>(method, path, body);
    }
    throw e;
  }
}

/** Fetch on mount / when deps change. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>("GET", path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  return { data, setData, error, reload: load };
}

export const TIER_LABELS: Record<string, string> = {
  plankton: "Plankton", tooclever: "Too Clever", schooler: "Schooler",
  rare: "Rare", deepcut: "Deep Cut", shrimpillion: "One in a Shrimpillion",
};

/** Create-or-resume the player's game for a round and return its id. */
export async function startGame(roundId: string): Promise<string> {
  const r = await api<{ game: { id: string } }>("POST", `/api/rounds/${roundId}/games`, {});
  return r.game.id;
}

/** Draw a fresh round (e.g. a pack's random dive), start it, and return the game id. */
export async function newDive(round: Record<string, unknown>): Promise<string> {
  const r = await api<{ round: { id: string } }>("POST", "/api/rounds", round);
  return startGame(r.round.id);
}

export function fullUrl(path: string) {
  return window.location.origin + path;
}
