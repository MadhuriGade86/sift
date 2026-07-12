// packages/shared/src/schemas.ts
//
// Single source of truth for validation, per plan.md functional requirements:
// "Validate on both sides with one shared Zod schema so the browser and the
// API reject the exact same bad input."
//
// Both packages/api and packages/web import from this package.
// No feature/route code lives here — pure schema + inferred types.

import { z } from "zod";

// ============================================================
// Enums (mirror db/migrations/0001_init.sql exactly)
// ============================================================

export const UserRole = z.enum(["admin", "recruiter", "interviewer"]);
export type UserRole = z.infer<typeof UserRole>;

export const JobStatus = z.enum(["draft", "open", "closed"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const CandidateSource = z.enum(["referral", "job_board", "direct", "other"]);
export type CandidateSource = z.infer<typeof CandidateSource>;

export const ApplicationStage = z.enum([
  "applied",
  "screen",
  "interview",
  "offer",
  "hired",
  "rejected",
]);
export type ApplicationStage = z.infer<typeof ApplicationStage>;

// ============================================================
// Shared primitives
// ============================================================

const uuid = z.string().uuid();
const isoDate = z.string().datetime();

// Password strength bar from plan.md A1: 8+ chars minimum for the trial's scope.
// (Real production would add breach-list checking; out of scope here.)
const password = z.string().min(8, "Password must be at least 8 characters");
const email = z.string().email().max(320);

// ============================================================
// Auth
// ============================================================

export const SignupCreateOrgSchema = z.object({
  mode: z.literal("create_org"),
  organizationName: z.string().min(1).max(200),
  email,
  password,
});

export const SignupJoinOrgSchema = z.object({
  mode: z.literal("join_org"),
  inviteToken: z.string().min(1), // raw token from the invite link; server hashes + looks up
  email,
  password,
});

export const SignupSchema = z.discriminatedUnion("mode", [
  SignupCreateOrgSchema,
  SignupJoinOrgSchema,
]);
export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email,
  password: z.string().min(1), // don't leak strength requirements on login, just "non-empty"
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const PasswordResetRequestSchema = z.object({ email });
export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: password,
});
export type PasswordResetConfirmInput = z.infer<typeof PasswordResetConfirmSchema>;

export const CreateInviteSchema = z.object({
  role: z.enum(["recruiter", "interviewer"]), // admin cannot be invited — see plan.md A1a
});
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;

// ============================================================
// Job
// ============================================================

export const JobCreateSchema = z.object({
  title: z.string().min(1).max(200),
  department: z.string().min(1).max(200),
  description: z.string().max(10_000).nullable().optional(),
});
export type JobCreateInput = z.infer<typeof JobCreateSchema>;

export const JobUpdateSchema = JobCreateSchema.partial().extend({
  status: JobStatus.optional(),
});
export type JobUpdateInput = z.infer<typeof JobUpdateSchema>;

export const JobSchema = z.object({
  id: uuid,
  organizationId: uuid,
  title: z.string(),
  department: z.string(),
  status: JobStatus,
  description: z.string().nullable(),
  createdBy: uuid,
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Job = z.infer<typeof JobSchema>;

// ============================================================
// Candidate + Application (created together — see plan.md C1)
// ============================================================

export const CandidateApplicationCreateSchema = z.object({
  jobId: uuid,
  candidate: z.object({
    name: z.string().min(1).max(200),
    email,
    resumeUrl: z.string().url().max(2000).nullable().optional(),
    source: CandidateSource.default("other"),
  }),
});
export type CandidateApplicationCreateInput = z.infer<typeof CandidateApplicationCreateSchema>;

export const ApplicationStageUpdateSchema = z.object({
  stage: ApplicationStage,
});
export type ApplicationStageUpdateInput = z.infer<typeof ApplicationStageUpdateSchema>;

export const ApplicationSchema = z.object({
  id: uuid,
  organizationId: uuid,
  candidateId: uuid,
  jobId: uuid,
  stage: ApplicationStage,
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Application = z.infer<typeof ApplicationSchema>;

// ============================================================
// Interview + Scorecard
// ============================================================

export const InterviewCreateSchema = z.object({
  applicationId: uuid,
  interviewerId: uuid,
  scheduledAt: isoDate,
});
export type InterviewCreateInput = z.infer<typeof InterviewCreateSchema>;

// Fixed small competency set for v1 — keeps scorecards comparable across
// interviewers, per the "structured, defensible hiring record" spirit
// documented in research.md (Ashby's enforced-scorecard pattern).
export const ScorecardCompetency = z.enum([
  "communication",
  "technical_skill",
  "problem_solving",
  "culture_add",
]);
export type ScorecardCompetency = z.infer<typeof ScorecardCompetency>;

const ratingValue = z.number().int().min(1).max(4);

export const ScorecardCreateSchema = z.object({
  ratings: z.record(ScorecardCompetency, ratingValue).refine(
    (r) => Object.keys(r).length === ScorecardCompetency.options.length,
    "All competencies must be rated"
  ),
  notes: z.string().max(5000).nullable().optional(),
});
export type ScorecardCreateInput = z.infer<typeof ScorecardCreateSchema>;

// ============================================================
// Search / list query params (shared shape for URL-mirrored filters, plan.md C3)
// ============================================================

export const ApplicationListQuerySchema = z.object({
  jobId: uuid.optional(),
  stage: ApplicationStage.optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ApplicationListQuery = z.infer<typeof ApplicationListQuerySchema>;
