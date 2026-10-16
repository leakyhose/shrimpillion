import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { Bank } from "./bank/bank.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db/index.ts";

const config = loadConfig();
const bank = Bank.load(config.bankPath);
const { db, close } = await openDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
const app = createApp({ db, bank, now: () => new Date() }, { corsOrigins: config.corsOrigins });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  const store = config.databaseUrl ? "postgres" : `pglite (${config.pgliteDir})`;
  console.log(`shrimpillion api on :${info.port} — bank ${bank.version} (${bank.prompts.size} prompts), db ${store}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void close().finally(() => process.exit(0));
  });
}
