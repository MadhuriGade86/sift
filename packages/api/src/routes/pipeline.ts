// packages/api/src/routes/pipeline.ts

import { Router } from "express";
import { eq, and, or, ilike, desc, asc, count, isNull, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { application, candidate, job, interview, scorecard } from "../db/schema";
import {
  CandidateApplicationCreateSchema,
  ApplicationStageUpdateSchema,
  ApplicationListQuerySchema,
} from "@sift/shared";
import { requireAuth, requireRole, requireVerifiedEmail } from "../middleware/auth";

export const pipelineRouter = Router();
pipelineRouter.use(requireAuth);

// ============================================================
// POST /api/applications — create candidate + application together (plan.md C1)
// ============================================================
pipelineRouter.post("/applications", requireVerifiedEmail, requireRole("recruiter"), async (req, res) => {
  const parsed = CandidateApplicationCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const orgId = req.sessionUser!.organizationId;

  // Verify the job belongs to this org before attaching anything to it —
  // row-level check, not just "some job with this id exists somewhere."
  const jobRows = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, parsed.data.jobId), eq(job.organizationId, orgId)))
    .limit(1);
  if (!jobRows[0]) return res.status(404).json({ error: "Job not found" });

  const [newCandidate] = await db
    .insert(candidate)
    .values({ organizationId: orgId, ...parsed.data.candidate })
    .returning();

  try {
    const [newApplication] = await db
      .insert(application)
      .values({
        organizationId: orgId,
        candidateId: newCandidate.id,
        jobId: parsed.data.jobId,
      })
      .returning();

    return res.status(201).json({ candidate: newCandidate, application: newApplication });
  } catch (err: unknown) {
    // Postgres unique_violation on (candidate_id, job_id) — plan.md edge case:
    // "candidate applies to the same job twice." Since we just created a brand
    // new candidate row above, this specific race is rare, but the same
    // constraint protects re-adding an existing candidate email to a job too
    // once candidate-matching-by-email is added later.
    const pgError = err as { code?: string };
    if (pgError.code === "23505") {
      return res.status(409).json({ error: "This candidate is already in this job's pipeline" });
    }
    throw err;
  }
});

// ============================================================
// GET /api/applications — search/filter/paginate the pipeline (plan.md C3)
// ============================================================
pipelineRouter.get("/applications", async (req, res) => {
  const orgId = req.sessionUser!.organizationId;
  const parsed = ApplicationListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query" });
  const { jobId, stage, search, page, pageSize } = parsed.data;

  const filters = [eq(application.organizationId, orgId), isNull(application.deletedAt)];
  if (jobId) filters.push(eq(application.jobId, jobId));
  if (stage) filters.push(eq(application.stage, stage));

  // Interviewers only ever see applications where they have an assigned
  // interview — enforced here, not just hidden in the UI (plan.md C role table).
  const isInterviewerOnly = req.sessionUser!.role === "interviewer";

  const baseQuery = db
    .select({
      application,
      candidate,
    })
    .from(application)
    .innerJoin(candidate, eq(application.candidateId, candidate.id));

  const rows = isInterviewerOnly
    ? await baseQuery
        .innerJoin(interview, eq(interview.applicationId, application.id))
        .where(
          and(
            ...filters,
            eq(interview.interviewerId, req.sessionUser!.userId),
            search ? or(ilike(candidate.name, `%${search}%`), ilike(candidate.email, `%${search}%`)) : undefined
          )
        )
        .orderBy(desc(application.createdAt), asc(application.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
    : await baseQuery
        .where(
          and(
            ...filters,
            search ? or(ilike(candidate.name, `%${search}%`), ilike(candidate.email, `%${search}%`)) : undefined
          )
        )
        .orderBy(desc(application.createdAt), asc(application.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

  return res.status(200).json({ data: rows, page, pageSize });
});

// ============================================================
// PATCH /api/applications/:id/stage — move a candidate through the pipeline (plan.md C2)
// ============================================================
pipelineRouter.patch(
  "/applications/:id/stage",
  requireVerifiedEmail,
  requireRole("recruiter"),
  async (req, res) => {
    const parsed = ApplicationStageUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const orgId = req.sessionUser!.organizationId;
    const appId = req.params.id;
    const targetStage = parsed.data.stage;

    const rows = await db
      .select()
      .from(application)
      .where(and(eq(application.id, appId), eq(application.organizationId, orgId)))
      .limit(1);
    const app = rows[0];
    if (!app) return res.status(404).json({ error: "Application not found" });

    // Gate 1 (plan.md C2): moving INTO 'interview' requires an assigned interviewer.
    if (targetStage === "interview") {
      const existingInterviews = await db
        .select({ id: interview.id })
        .from(interview)
        .where(eq(interview.applicationId, appId))
        .limit(1);
      if (!existingInterviews[0]) {
        return res
          .status(400)
          .json({ error: "Assign an interviewer before moving this candidate to Interview stage" });
      }
    }

    // Gate 2 (plan.md C2, inspired by Ashby — research.md): moving OUT of
    // 'interview' requires every scheduled interview for this application to
    // have a submitted scorecard. Enforced server-side — a direct API call
    // bypassing the UI still gets rejected.
    if (app.stage === "interview" && targetStage !== "interview") {
      const interviewsForApp = await db
        .select({ id: interview.id })
        .from(interview)
        .where(eq(interview.applicationId, appId));

      if (interviewsForApp.length > 0) {
        const scorecardsSubmitted = await db
          .select({ interviewId: scorecard.interviewId })
          .from(scorecard)
          .where(
            inArray(
              scorecard.interviewId,
              interviewsForApp.map((iv) => iv.id)
            )
          );
        const submittedIds = new Set(scorecardsSubmitted.map((s) => s.interviewId));
        const missing = interviewsForApp.filter((iv) => !submittedIds.has(iv.id));
        if (missing.length > 0) {
          return res.status(400).json({
            error: "All scheduled interviews need a submitted scorecard before advancing this candidate",
          });
        }
      }
    }

    const [updated] = await db
      .update(application)
      .set({ stage: targetStage })
      .where(and(eq(application.id, appId), eq(application.organizationId, orgId)))
      .returning();

    return res.status(200).json(updated);
  }
);
