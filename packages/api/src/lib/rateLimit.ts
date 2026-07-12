// packages/api/src/lib/rateLimit.ts
//
// Rate limiting via a Postgres row per (identifier, route), not an
// in-memory token bucket — plan.md §6: two concurrent serverless function
// instances don't share memory, so an in-memory limiter would silently
// under-count and defeat the whole point.

import { sql } from "drizzle-orm";
import { db } from "../db/client";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Atomically increments the attempt counter for (identifier, route).
 * Uses a single upsert with a CASE so the check-then-increment can't race
 * across two concurrent requests hitting different function instances —
 * the whole operation is one statement, so Postgres serializes it per row.
 */
export async function checkRateLimit(identifier: string, route: string): Promise<RateLimitResult> {
  const windowStartCutoff = new Date(Date.now() - WINDOW_MS);

  const rows = await db.execute(sql`
    INSERT INTO rate_limit_attempt (identifier, route, attempt_count, window_start, updated_at)
    VALUES (${identifier}, ${route}, 1, now(), now())
    ON CONFLICT (identifier, route) DO UPDATE SET
      attempt_count = CASE
        WHEN rate_limit_attempt.window_start < ${windowStartCutoff.toISOString()}::timestamptz
          THEN 1  -- window expired, reset
        ELSE rate_limit_attempt.attempt_count + 1
      END,
      window_start = CASE
        WHEN rate_limit_attempt.window_start < ${windowStartCutoff.toISOString()}::timestamptz
          THEN now()
        ELSE rate_limit_attempt.window_start
      END,
      updated_at = now()
    RETURNING attempt_count, window_start;
  `);

  const row = (rows as unknown as { attempt_count: number; window_start: string }[])[0];
  if (!row) return { allowed: true };

  if (row.attempt_count > MAX_ATTEMPTS) {
    const windowStart = new Date(row.window_start).getTime();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStart + WINDOW_MS - Date.now()) / 1000)
    );
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true };
}
