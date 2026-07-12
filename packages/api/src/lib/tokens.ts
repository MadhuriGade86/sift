// packages/api/src/lib/tokens.ts
//
// Password reset and org-invite tokens share one shape (auth_token table)
// and one rule: the raw token is only ever shown to the user once (in the
// email/invite link) and is never stored — only its hash is. Losing the DB
// does not leak usable tokens.

import { randomBytes, createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { authToken } from "../db/schema";

const RESET_TTL_MS = 30 * 60 * 1000; // 30 min, within the 15-30 min TTL window from the spec
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const raw = generateRawToken();
  await db.insert(authToken).values({
    kind: "password_reset",
    tokenHash: hashToken(raw),
    userId,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  return raw; // caller emails this; never logged, never stored raw
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const raw = generateRawToken();
  await db.insert(authToken).values({
    kind: "email_verification",
    tokenHash: hashToken(raw),
    userId,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  return raw;
}

export async function createInviteToken(
  organizationId: string,
  role: "recruiter" | "interviewer",
  createdBy: string
): Promise<string> {
  const raw = generateRawToken();
  await db.insert(authToken).values({
    kind: "org_invite",
    tokenHash: hashToken(raw),
    organizationId,
    inviteRole: role,
    createdBy,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return raw;
}

/**
 * Looks up an unexpired, unused token by kind. Does NOT mark it used —
 * call `consumeToken` after the caller successfully completes the action
 * the token authorizes, so a failed downstream step (e.g. weak new
 * password) doesn't burn the token.
 */
export async function findValidToken(
  raw: string,
  kind: "password_reset" | "email_verification" | "org_invite"
) {
  const hash = hashToken(raw);
  const rows = await db
    .select()
    .from(authToken)
    .where(and(eq(authToken.tokenHash, hash), eq(authToken.kind, kind), isNull(authToken.usedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function consumeToken(tokenId: string): Promise<void> {
  await db.update(authToken).set({ usedAt: new Date() }).where(eq(authToken.id, tokenId));
}
