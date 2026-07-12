// packages/api/src/routes/jobs.ts

import { Router } from "express";
import { eq, and, ilike, desc, asc, sql, count } from "drizzle-orm";
import { db } from "../db/client";
import { job, application } from "../db/schema";
import { JobCreateSchema, JobUpdateSchema } from "@sift/shared";
import { requireAuth, requireRole, requireVerifiedEmail } from "../middleware/auth";

export const jobsRouter = Router();

// All routes below require a logged-in user; org scoping happens via
// req.sessionUser.organizationId on every query, never from a client param.
jobsRouter.use(requireAuth);

// ============================================================
// GET /api/jobs — list, server-side search + pagination (plan.md B2)
// ============================================================
jobsRouter.get("/", async (req, res) => {
  const orgId = req.sessionUser!.organizationId;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

  const filters = [eq(job.organizationId, orgId)];
  if (search) filters.push(ilike(job.title, `%${search}%`));

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(job)
      .where(and(...filters))
      .orderBy(desc(job.createdAt), asc(job.id)) // stable secondary sort on id, per functional spec
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: count() })
      .from(job)
      .where(and(...filters)),
  ]);

  return res.status(200).json({
    data: rows,
    page,
    pageSize,
    total: totalRows[0]?.count ?? 0,
  });
});

// ============================================================
// POST /api/jobs (plan.md B1)
// ============================================================
jobsRouter.post("/", requireVerifiedEmail, requireRole("recruiter"), async (req, res) => {
  const parsed = JobCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const [created] = await db
    .insert(job)
    .values({
      organizationId: req.sessionUser!.organizationId,
      title: parsed.data.title,
      department: parsed.data.department,
      description: parsed.data.description ?? null,
      createdBy: req.sessionUser!.userId,
    })
    .returning();

  return res.status(201).json(created); // return mutated record — no second GET needed
});

// ============================================================
// GET /api/jobs/:id
// ============================================================
jobsRouter.get("/:id", async (req, res) => {
  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.id, req.params.id), eq(job.organizationId, req.sessionUser!.organizationId)))
    .limit(1);

  const row = rows[0];
  if (!row) return res.status(404).json({ error: "Job not found" });
  return res.status(200).json(row);
});

// ============================================================
// PATCH /api/jobs/:id (plan.md B2 — edit and/or close)
// ============================================================
jobsRouter.patch("/:id", requireVerifiedEmail, requireRole("recruiter"), async (req, res) => {
  const parsed = JobUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const orgId = req.sessionUser!.organizationId;
  const existing = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, req.params.id), eq(job.organizationId, orgId)))
    .limit(1);
  if (!existing[0]) return res.status(404).json({ error: "Job not found" });

  const [updated] = await db
    .update(job)
    .set(parsed.data)
    .where(and(eq(job.id, req.params.id), eq(job.organizationId, orgId)))
    .returning();

  return res.status(200).json(updated);
});

// ============================================================
// DELETE /api/jobs/:id — admin only, hard delete, soft-cascades applications (plan.md B3)
// ============================================================
jobsRouter.delete("/:id", requireVerifiedEmail, requireRole("admin"), async (req, res) => {
  const orgId = req.sessionUser!.organizationId;
  const jobId = req.params.id;

  const existing = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId)))
    .limit(1);
  if (!existing[0]) return res.status(404).json({ error: "Job not found" });

  // Soft-delete affected applications first (explicit cascade rule, per
  // plan.md B3 — recovery matters here, so this isn't a hard delete even
  // though the job row itself is hard-deleted via FK cascade below).
  await db
    .update(application)
    .set({ deletedAt: new Date() })
    .where(and(eq(application.jobId, jobId), eq(application.organizationId, orgId)));

  await db.delete(job).where(and(eq(job.id, jobId), eq(job.organizationId, orgId)));

  return res.status(200).json({ message: "Job deleted" });
});
