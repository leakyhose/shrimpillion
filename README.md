# Shrimpillion

A lite, shrimp-flavoured clone of [krillion.io](https://krillion.io): name the rarest answer you can and watch it sink.

**Stack:** TypeScript, React 19 + Vite, Hono on Node, Drizzle with Postgres (or embedded PGlite locally).

## Running locally

Needs Node 22+.

```sh
npm install
npm run bank   # build the prompt bank into data/bank/
npm run dev    # API on :8787, web on http://localhost:5173
```

The raw data the prompt bank is built from isn't included in this repo, so `npm run bank` needs your own copy in `research/data/`. Without `DATABASE_URL`, games are stored in `.data/`.

## Tests

```sh
npm test
```

The API tests and the matcher probe-log tests are skipped when the raw data isn't present.

by Yiming Su
