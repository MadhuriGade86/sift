// packages/api/src/routes/interviews.ts

import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { interview, application, scorecard, appUser } from "../db/schema";
import { InterviewCreateSchema, ScorecardCreateSchema } from "@sift/shared";
import { requireAuth, requireRole, requireVerifiedEmail } from "../middleware/auth";

export const interviewsRouter = Router();
interviewsRouter.use(requireAuth);

// ============================================================
// POST /api/interviews — schedule + assign interviewer (plan.md D1)
// ============================================================
interviewsRouter.post("/", requireVerifiedEmail, requireRole("recruiter"), async (req, res) => {
  const parsed = InterviewCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const orgId = req.sessionUser!.organizationId;

  const appRows = await db
    .select({ id: application.id })
    .from(application)
    .where(and(eq(application.id, parsed.data.applicationId), eq(application.organizationId, orgId)))
    .limit(1);
  if (!appRows[0]) return res.status(404).json({ error: "Application not found" });

  const interviewerRows = await db
    .select({ id: appUser.id, role: appUser.role })
    .from(appUser)
    .where(and(eq(appUser.id, parsed.data.interviewerId), eq(appUser.organizationId, orgId)))
    .limit(1);
  if (!interviewerRows[0]) {
    return res.status(400).json({ error: "Interviewer must belong to your organization" });
  }

  const [created] = await db
    .insert(interview)
    .values({
      organizationId: orgId,
      applicationId: parsed.data.applicationId,
      interviewerId: parsed.data.interviewerId,
      scheduledAt: new Date(parsed.data.scheduledAt),
    })
    .returning();

  return res.status(201).json(created);
});

// ============================================================
// GET /api/interviews/:id/scorecards — view scorecards for an interview's application
//
// Anti-anchoring rule (plan.md D2, research.md — Lever pattern): an
// interviewer cannot see any other interviewer's scorecard for the SAME
// application until they've submitted their own for their assigned
// interview. Recruiters/admins always see everything.
// ============================================================
interviewsRouter.get("/:id/scorecards", async (req, res) => {
  const orgId = req.sessionUser!.organizationId;
  const interviewRows = await db
    .select()
    .from(interview)
    .where(and(eq(interview.id, req.params.id), eq(interview.organizationId, orgId)))
    .limit(1);
  const thisInterview = interviewRows[0];
  if (!thisInterview) return res.status(404).json({ error: "Interview not found" });

  const isInterviewer = req.sessionUser!.role === "interviewer";

  if (isInterviewer) {
    // An interviewer can only look at scorecards tied to interviews they
    // themselves were assigned — row-level check independent of role.
    if (thisInterview.interviewerId !== req.sessionUser!.userId) {
      return res.status(403).json({ error: "Not your interview" });
    }

    const ownScorecard = await db
      .select()
      .from(scorecard)
      .where(eq(scorecard.interviewId, thisInterview.id))
      .limit(1);

    if (!ownScorecard[0]) {
      // Haven't submitted their own yet — they see nothing from anyone,
      // including their own (there is nothing of their own yet).
      return res.status(200).json({ scorecards: [], reason: "Submit your scorecard to see others'" });
    }
  }

  // Recruiter/admin, or an interviewer who has already submitted: show every
  // scorecard for every interview belonging to the same application.
  const allInterviewsForApp = await db
    .select({ id: interview.id })
    .from(interview)
    .where(eq(interview.applicationId, thisInterview.applicationId));

  const interviewIds = allInterviewsForApp.map((iv) => iv.id);

  const allScorecards =
    interviewIds.length > 0
      ? await db.select().from(scorecard).where(inArray(scorecard.interviewId, interviewIds))
      : [];

  return res.status(200).json({ scorecards: allScorecards });
});

// ============================================================
// POST /api/interviews/:id/scorecard — submit (plan.md D2)
// ============================================================
interviewsRouter.post("/:id/scorecard", requireVerifiedEmail, async (req, res) => {
  const orgId = req.sessionUser!.organizationId;
  const parsed = ScorecardCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const interviewRows = await db
    .select()
    .from(interview)
    .where(and(eq(interview.id, req.params.id), eq(interview.organizationId, orgId)))
    .limit(1);
  const thisInterview = interviewRows[0];
  if (!thisInterview) return res.status(404).json({ error: "Interview not found" });

  // Only the assigned interviewer may submit — checked at the row level,
  // not just by role (plan.md D2).
  if (thisInterview.interviewerId !== req.sessionUser!.userId) {
    return res.status(403).json({ error: "Only the assigned interviewer can submit this scorecard" });
  }

  const existing = await db
    .select({ id: scorecard.id })
    .from(scorecard)
    .where(eq(scorecard.interviewId, thisInterview.id))
    .limit(1);
  if (existing[0]) {
    // Immutable once submitted (plan.md D2) — no edit endpoint exists;
    // this is the deliberate enforcement point.
    return res.status(409).json({ error: "Scorecard already submitted for this interview" });
  }

  const [created] = await db
    .insert(scorecard)
    .values({
      interviewId: thisInterview.id,
      submittedBy: req.sessionUser!.userId,
      ratings: parsed.data.ratings,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  return res.status(201).json(created);
});
