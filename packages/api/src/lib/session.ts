// packages/api/src/lib/session.ts
//
// Sessions are rows in Postgres, not in-memory (plan.md §6 — serverless
// functions share no memory across invocations). The session row's `id`
// (a UUID) is the only thing stored in the cookie; it's an opaque lookup
// key, not a signed/encoded token, so there's nothing to forge — an
// attacker without a valid row id gets nothing.

import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { session as sessionTable, appUser } from "../db/schema";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const COOKIE_NAME = "sift_session";

export interface SessionUser {
  sessionId: string;
  userId: string;
  organizationId: string;
  role: "admin" | "recruiter" | "interviewer";
  emailVerified: boolean;
}

export async function createSession(userId: string): Promise<string> {
  const [row] = await db
    .insert(sessionTable)
    .values({
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning({ id: sessionTable.id });
  return row.id;
}

/** Deletes a session row outright — used on logout and on session rotation. */
export async function revokeSession(sessionId: string): Promise<void> {
  await db.delete(sessionTable).where(eq(sessionTable.id, sessionId));
}

/** Revokes every session belonging to a user — used when a role changes (plan.md A4). */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
}

/**
 * Looks up a session by id and joins the current user row, so role/org
 * are always read fresh from the DB on every request rather than trusted
 * from a stale cookie payload (plan.md A4 requirement).
 */
export async function loadSessionUser(sessionId: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      sessionId: sessionTable.id,
      expiresAt: sessionTable.expiresAt,
      userId: appUser.id,
      organizationId: appUser.organizationId,
      role: appUser.role,
      emailVerified: appUser.emailVerified,
    })
    .from(sessionTable)
    .innerJoin(appUser, eq(sessionTable.userId, appUser.id))
    .where(eq(sessionTable.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    // Expired — clean it up lazily rather than requiring a cron job for v1.
    await revokeSession(sessionId);
    return null;
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    organizationId: row.organizationId,
    role: row.role,
    emailVerified: row.emailVerified,
  };
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function readSessionCookie(req: Request): string | undefined {
  return req.cookies?.[COOKIE_NAME];
}

/**
 * Session rotation: issue a brand-new session row + cookie, revoke the old
 * one. Called on login and on any privilege change, per plan.md A2/A4
 * (kills session fixation).
 */
export async function rotateSession(
  res: Response,
  userId: string,
  oldSessionId?: string
): Promise<string> {
  const newSessionId = await createSession(userId);
  if (oldSessionId) await revokeSession(oldSessionId);
  setSessionCookie(res, newSessionId);
  return newSessionId;
}
