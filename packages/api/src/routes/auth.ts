// packages/api/src/routes/auth.ts

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { organization, appUser } from "../db/schema";
import { SignupSchema, LoginSchema, PasswordResetRequestSchema, PasswordResetConfirmSchema, CreateInviteSchema } from "@sift/shared";
import { hashPassword, verifyPassword } from "../lib/password";
import { rotateSession, revokeSession, revokeAllSessionsForUser, clearSessionCookie, readSessionCookie } from "../lib/session";
import { checkRateLimit } from "../lib/rateLimit";
import {
  createEmailVerificationToken,
  createPasswordResetToken,
  createInviteToken,
  findValidToken,
  consumeToken,
} from "../lib/tokens";
import { sendEmail, verificationEmailHtml, passwordResetEmailHtml, inviteEmailHtml } from "../lib/email";
import { requireAuth, requireRole } from "../middleware/auth";

export const authRouter = Router();

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

// Generic response for "email exists" style questions — same message
// whether the account exists or not, so responses can't be used to
// enumerate registered emails (plan.md A1).
const GENERIC_EMAIL_SENT_MESSAGE = { message: "If that email is valid, check your inbox." };

// ============================================================
// POST /api/auth/signup
// ============================================================
authRouter.post("/signup", async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const input = parsed.data;

  const existing = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, input.email)).limit(1);
  if (existing.length > 0) {
    // Same response as success — don't confirm the account exists (A1).
    return res.status(200).json(GENERIC_EMAIL_SENT_MESSAGE);
  }

  const passwordHash = await hashPassword(input.password);
  let organizationId: string;
  let role: "admin" | "recruiter" | "interviewer";

  if (input.mode === "create_org") {
    const [org] = await db.insert(organization).values({ name: input.organizationName }).returning({ id: organization.id });
    organizationId = org.id;
    role = "admin"; // first user in a new org is always its admin
  } else {
    const tokenRow = await findValidToken(input.inviteToken, "org_invite");
    if (!tokenRow || !tokenRow.organizationId || !tokenRow.inviteRole) {
      return res.status(400).json({ error: "Invite link is invalid or has expired" });
    }
    organizationId = tokenRow.organizationId;
    role = tokenRow.inviteRole; // invitee cannot self-select role — locked to what the invite specifies (A1a)
    await consumeToken(tokenRow.id);
  }

  const [user] = await db
    .insert(appUser)
    .values({ organizationId, email: input.email, passwordHash, role })
    .returning({ id: appUser.id });

  const verifyToken = await createEmailVerificationToken(user.id);
  await sendEmail({
    to: input.email,
    subject: "Verify your Sift account",
    html: verificationEmailHtml(`${APP_URL}/verify-email?token=${verifyToken}`),
  });

  await rotateSession(res, user.id);
  return res.status(201).json(GENERIC_EMAIL_SENT_MESSAGE);
});

// ============================================================
// POST /api/auth/login
// ============================================================
authRouter.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const { email, password } = parsed.data;

  const ip = req.ip ?? "unknown";
  const rateLimit = await checkRateLimit(`ip:${ip}|account:${email}`, "login");
  if (!rateLimit.allowed) {
    res.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many login attempts. Try again later." });
  }

  const rows = await db.select().from(appUser).where(eq(appUser.email, email)).limit(1);
  const user = rows[0];

  // Identical error for "no such user" and "wrong password" — don't leak
  // which one it was (A2).
  const genericError = () => res.status(401).json({ error: "Invalid email or password" });

  if (!user) return genericError();
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return genericError();

  await rotateSession(res, user.id);
  return res.status(200).json({ userId: user.id, role: user.role, organizationId: user.organizationId });
});

// ============================================================
// POST /api/auth/logout
// ============================================================
authRouter.post("/logout", async (req, res) => {
  const sessionId = readSessionCookie(req);
  if (sessionId) await revokeSession(sessionId);
  clearSessionCookie(res);
  return res.status(200).json({ message: "Logged out" });
});

// ============================================================
// GET /api/auth/me
// ============================================================
authRouter.get("/me", requireAuth, (req, res) => {
  return res.status(200).json(req.sessionUser);
});

// ============================================================
// POST /api/auth/verify-email
// ============================================================
authRouter.post("/verify-email", async (req, res) => {
  const token = String(req.body?.token ?? "");
  const tokenRow = await findValidToken(token, "email_verification");
  if (!tokenRow || !tokenRow.userId) {
    return res.status(400).json({ error: "Verification link is invalid or has expired" });
  }
  await db.update(appUser).set({ emailVerified: true }).where(eq(appUser.id, tokenRow.userId));
  await consumeToken(tokenRow.id);
  return res.status(200).json({ message: "Email verified" });
});

// ============================================================
// POST /api/auth/password-reset/request
// ============================================================
authRouter.post("/password-reset/request", async (req, res) => {
  const parsed = PasswordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const ip = req.ip ?? "unknown";
  const rateLimit = await checkRateLimit(`ip:${ip}|account:${parsed.data.email}`, "password_reset");
  if (!rateLimit.allowed) {
    res.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many reset attempts. Try again later." });
  }

  const rows = await db.select().from(appUser).where(eq(appUser.email, parsed.data.email)).limit(1);
  const user = rows[0];

  // Always return the generic message, whether or not the account exists —
  // this is the whole point of the "generic message" pattern (A3).
  if (user) {
    const resetToken = await createPasswordResetToken(user.id);
    await sendEmail({
      to: user.email,
      subject: "Reset your Sift password",
      html: passwordResetEmailHtml(`${APP_URL}/reset-password?token=${resetToken}`),
    });
  }
  return res.status(200).json(GENERIC_EMAIL_SENT_MESSAGE);
});

// ============================================================
// POST /api/auth/password-reset/confirm
// ============================================================
authRouter.post("/password-reset/confirm", async (req, res) => {
  const parsed = PasswordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const tokenRow = await findValidToken(parsed.data.token, "password_reset");
  if (!tokenRow || !tokenRow.userId) {
    return res.status(400).json({ error: "Reset link is invalid or has expired" });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await db.update(appUser).set({ passwordHash }).where(eq(appUser.id, tokenRow.userId));
  await consumeToken(tokenRow.id);

  // Revoke every existing session on password reset — if the reset was
  // triggered because credentials leaked, old sessions shouldn't survive it.
  await revokeAllSessionsForUser(tokenRow.userId);

  return res.status(200).json({ message: "Password updated. Please log in again." });
});

// ============================================================
// POST /api/auth/invite  (admin only — plan.md A1a)
// ============================================================
authRouter.post("/invite", requireAuth, requireRole("admin"), async (req, res) => {
  const parsed = CreateInviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, req.sessionUser!.organizationId))
    .limit(1);

  const inviteToken = await createInviteToken(
    req.sessionUser!.organizationId,
    parsed.data.role,
    req.sessionUser!.userId
  );
  const inviteUrl = `${APP_URL}/signup?invite=${inviteToken}`;

  // Return the URL directly (admin can copy/share it) — email is a nice-to-have,
  // not required, since the admin already has the link in the response.
  return res.status(201).json({ inviteUrl });
});
