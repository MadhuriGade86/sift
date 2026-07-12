// packages/api/src/db/client.ts
//
// Uses Neon's serverless driver rather than a raw `pg.Pool`.
// Rationale (plan.md §6): traditional long-lived connection pools don't
// suit serverless functions, which spin up/down per request. Neon's
// driver is designed for exactly this — HTTP-based queries with no
// persistent socket to manage across invocations.

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
