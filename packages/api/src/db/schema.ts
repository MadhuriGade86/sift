// packages/api/src/db/schema.ts
//
// Drizzle ORM schema — mirrors db/migrations/0001_init.sql exactly.
// This file is the typed-query layer; the SQL migration is the reviewable
// source of truth for the actual DDL. Keep them in sync by hand for now
// (drizzle-kit introspection can regenerate this from the live DB later
// if it drifts).

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ============================================================
// Enums
// ============================================================

export const userRoleEnum = pgEnum("user_role", ["admin", "recruiter", "interviewer"]);
export const jobStatusEnum = pgEnum("job_status", ["draft", "open", "closed"]);
export const candidateSourceEnum = pgEnum("candidate_source", [
  "referral",
  "job_board",
  "direct",
  "other",
]);
export const applicationStageEnum = pgEnum("application_stage", [
  "applied",
  "screen",
  "interview",
  "offer",
  "hired",
  "rejected",
]);
export const tokenKindEnum = pgEnum("token_kind", [
  "password_reset",
  "email_verification",
  "org_invite",
]);

// ============================================================
// Tenancy
// ============================================================

export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// Auth & Users
// ============================================================

export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("interviewer"),
    emailVerified: boolean("email_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("idx_app_user_organization_id").on(t.organizationId),
  })
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_session_user_id").on(t.userId),
    expiresIdx: index("idx_session_expires_at").on(t.expiresAt),
  })
);

export const authToken = pgTable(
  "auth_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: tokenKindEnum("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").references(() => appUser.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    inviteRole: userRoleEnum("invite_role"),
    createdBy: uuid("created_by").references(() => appUser.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Note: the CHECK constraints enforcing "password_reset tokens have a
  // user_id" and "org_invite tokens have an organization_id + valid role"
  // live only in db/migrations/0001_init.sql — drizzle-orm's pg-core table
  // builder doesn't support CHECK constraints as of this schema version.
  // The application layer must also enforce this invariant when writing
  // auth_token rows (defense in depth, not a substitute for the DB check).
  (t) => ({
    tokenHashIdx: index("idx_auth_token_hash").on(t.tokenHash),
  })
);

export const rateLimitAttempt = pgTable(
  "rate_limit_attempt",
  {
    identifier: text("identifier").notNull(),
    route: text("route").notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.route] }),
  })
);

// ============================================================
// Jobs
// ============================================================

export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    department: text("department").notNull(),
    status: jobStatusEnum("status").notNull().default("draft"),
    description: text("description"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("idx_job_organization_id").on(t.organizationId),
    orgStatusIdx: index("idx_job_org_status").on(t.organizationId, t.status),
  })
);

// ============================================================
// Candidates & Applications
// ============================================================

export const candidate = pgTable(
  "candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    resumeUrl: text("resume_url"),
    source: candidateSourceEnum("source").notNull().default("other"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("idx_candidate_organization_id").on(t.organizationId),
    // Trigram indexes are created in the raw SQL migration (pg_trgm GIN
    // indexes aren't natively expressible via drizzle-orm's pg-core builder).
  })
);

export const application = pgTable(
  "application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    stage: applicationStageEnum("stage").notNull().default("applied"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgJobStageIdx: index("idx_application_org_job_stage").on(
      t.organizationId,
      t.jobId,
      t.stage
    ),
    candidateIdx: index("idx_application_candidate_id").on(t.candidateId),
    candidateJobUnique: uniqueIndex("application_candidate_id_job_id_key").on(
      t.candidateId,
      t.jobId
    ),
  })
);

// ============================================================
// Interviews & Scorecards
// ============================================================

export const interview = pgTable(
  "interview",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    interviewerId: uuid("interviewer_id")
      .notNull()
      .references(() => appUser.id),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    interviewerIdx: index("idx_interview_interviewer_id").on(t.interviewerId),
    applicationIdx: index("idx_interview_application_id").on(t.applicationId),
  })
);

export const scorecard = pgTable("scorecard", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id")
    .notNull()
    .unique()
    .references(() => interview.id, { onDelete: "cascade" }),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => appUser.id),
  ratings: jsonb("ratings").notNull().$type<Record<string, number>>(),
  notes: text("notes"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});
