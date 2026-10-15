import { eq } from "drizzle-orm";
import type { Services } from "../context.ts";
import { schema } from "../db/index.ts";
import { hashToken, newToken, randomId } from "../util.ts";

export type Player = typeof schema.players.$inferSelect;

export function displayName(p: { id: string; name: string | null }): string {
  return p.name ?? `Diver ${p.id.slice(0, 4)}`;
}

export function playerView(p: Player) {
  return { id: p.id, name: p.name, displayName: displayName(p), createdAt: p.createdAt };
}

export async function createPlayer(s: Services, name?: string): Promise<{ player: Player; token: string }> {
  const token = newToken();
  const [player] = await s.db
    .insert(schema.players)
    .values({ id: randomId(12), tokenHash: hashToken(token), name: name ?? null })
    .returning();
  return { player: player!, token };
}

export async function playerByToken(s: Services, token: string): Promise<Player | undefined> {
  const [p] = await s.db.select().from(schema.players).where(eq(schema.players.tokenHash, hashToken(token)));
  return p;
}

export async function renamePlayer(s: Services, id: string, name: string | null): Promise<Player> {
  const [p] = await s.db.update(schema.players).set({ name }).where(eq(schema.players.id, id)).returning();
  return p!;
}
