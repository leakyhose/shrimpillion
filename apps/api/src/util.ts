import { createHash, randomBytes, randomInt } from "node:crypto";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Lowercase letters and digits without look-alikes (0/o, 1/l/i), for links people type. */
const LINK_SAFE = "23456789abcdefghjkmnpqrstuvwxyz";

/** URL-safe random id. Default: base62, 10 chars ≈ 59 bits. */
export function randomId(length = 10, alphabet = BASE62): string {
  const limit = 256 - (256 % alphabet.length); // drop the tail of the byte range to avoid modulo bias
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Short id for shared links, e.g. "k7m2qx" (31^6 ≈ 890M). */
export const shortId = () => randomId(6, LINK_SAFE);

/** Run an insert keyed by a fresh short id, drawing another if it happens to be taken. */
export async function withShortId<T>(insert: (id: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insert(shortId());
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      const taken = err.code === "23505" || err.cause?.code === "23505";
      if (!taken || attempt >= 5) throw e;
    }
  }
}

export function newToken(): string {
  return "shr_" + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
