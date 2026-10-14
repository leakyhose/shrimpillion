import { fileURLToPath } from "node:url";

export const DEFAULT_BANK_PATH = fileURLToPath(new URL("../../../data/bank/bank.json", import.meta.url));
const DEFAULT_PGLITE_DIR = fileURLToPath(new URL("../../../.data/pglite", import.meta.url));

export interface Config {
  port: number;
  /** Postgres connection string. When unset, an embedded PGlite database is used. */
  databaseUrl?: string;
  /** PGlite data directory, or "memory://" for a throwaway database. */
  pgliteDir: string;
  bankPath: string;
  /** Allowed browser origins, e.g. the Vercel frontend. "*" allows any. */
  corsOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR ?? DEFAULT_PGLITE_DIR,
    bankPath: env.BANK_PATH ?? DEFAULT_BANK_PATH,
    corsOrigins: (env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
