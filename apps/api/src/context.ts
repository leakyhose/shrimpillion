import type { Bank } from "./bank/bank.ts";
import type { Db } from "./db/index.ts";

export interface Services {
  db: Db;
  bank: Bank;
  /** Injectable clock, so tests can run out the timer. */
  now: () => Date;
}
