// packages/api/src/middleware/auth.ts
//
// Every route in this app goes through `attachSession`. Routes that need
// a logged-in user add `requireAuth`; routes restricted by role add
// `requireRole(...)`. The role and organizationId used for every check
// are read from `req.sessionUser`, which is populated here from the DB —
// never from anything the client sent (plan.md §1, functional spec
// "Auth & Access": RBAC enforced server-side, never trust a client role).

import type { Request, Response, NextFunction } from "express";
import { readSessionCookie, loadSessionUser, type SessionUser } from "../lib/session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
    }
  }
}

export async function attachSession(req: Request, _res: Response, next: NextFunction) {
  const sessionId = readSessionCookie(req);
  if (!sessionId) return next();

  const sessionUser = await loadSessionUser(sessionId);
  if (sessionUser) req.sessionUser = sessionUser;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.sessionUser) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

/** Blocks write actions until the user's email is verified (plan.md A1). */
export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  if (!req.sessionUser) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (!req.sessionUser.emailVerified) {
    return res.status(403).json({ error: "Email verification required for this action" });
  }
  next();
}

/**
 * Role gate. Roles are hierarchical for convenience: admin > recruiter >
 * interviewer, so `requireRole("recruiter")` also allows admins through.
 * Pass an explicit array instead if you need a non-hierarchical check
 * (e.g. "only admins, not even recruiters").
 */
const ROLE_RANK = { interviewer: 0, recruiter: 1, admin: 2 } as const;

export function requireRole(minimumRole: keyof typeof ROLE_RANK) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.sessionUser) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (ROLE_RANK[req.sessionUser.role] < ROLE_RANK[minimumRole]) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
