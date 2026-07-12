# Sift — Product Plan

**One-line pitch:** Sift is a lightweight applicant tracking system that lets small hiring teams run a structured, collaborative candidate pipeline — from job posting to hire — without the enterprise-ATS bloat.

**Category:** HR & Recruiting (ATS)
**Stack:** Node/Express (API, deployed as a Vercel serverless function via `serverless-http`) + React (SPA), PostgreSQL. Both frontend and API deploy from the same Vercel project.
**Multi-tenancy:** Yes — each signup either creates a new organization or joins an existing one. All data is scoped by `organization_id`.
**Timebox:** 7–14 days. **Risk flag:** multi-tenancy + serverless are both scope-increasing choices — see §7 Open Questions for the scope-control decisions this forces.

---

## 1. Roles & RBAC & Tenancy

Every table below `Organization` carries an `organization_id`. Every query is scoped to `req.session.organizationId` server-side — a user can never read or write a row belonging to another organization, regardless of what the client sends. This is enforced in one shared middleware/query-helper layer, not repeated ad hoc per route, so it can't be accidentally skipped.

| Role | Can do |
|---|---|
| **Admin** | Everything a Recruiter can, plus: manage users/roles within their org, delete jobs, view audit log, generate/revoke org invite links |
| **Recruiter** | Create/edit/close jobs, add candidates, move candidates through pipeline stages, assign interviewers, view all scorecards — all scoped to their own org |
| **Interviewer** | View only candidates assigned to them within their org, submit a scorecard for their assigned interview — cannot see other interviewers' scorecards until their own is submitted, cannot advance pipeline stage, cannot see candidates not assigned to them |

RBAC is enforced **server-side on every route** — the client never sends or trusts a role; the server derives both role AND organization from the session on each request. A row-level check is always "does this resource belong to the actor's org AND does the actor's role permit this action" — never just one or the other.

---

## 2. Entities & Relationships

```
Organization (1) ──< has many >── (N) User
Organization (1) ──< has many >── (N) Job
Organization (1) ──< has many >── (N) Candidate
User (1) ──< assigned_to >── (N) Interview
Job (1) ──< has many >── (N) Application
Candidate (1) ──< has many >── (N) Application
Application (1) ──< has many >── (N) Interview
Interview (1) ──< has one >── (0..1) Scorecard
```

- **Organization** — the tenant boundary (name, created_at). Everything else belongs to exactly one organization.
- **User** — recruiter/admin/interviewer accounts, each belonging to exactly one organization (auth entity)
- **Job** — a requisition (title, department, status: open/closed/draft), belongs to one org
- **Candidate** — a person (name, email, resume link, source), belongs to one org
- **Application** — the join entity: one candidate applying to one job, carries the **pipeline stage** (this is the entity that actually moves through the kanban board)
- **Interview** — a scheduled interview tied to one application, with one assigned interviewer
- **Scorecard** — the interviewer's structured feedback for one interview (1:1 with Interview)

This is "medium ambition" scope plus the tenancy layer: 5 core entities (Organization, Job, Candidate, Application, Interview+Scorecard) with real foreign-key relationships and org-scoping enforced at every read/write.

---

## 3. User Stories & Acceptance Criteria

### Epic A — Authentication, Access & Organizations

**A1. As a new user, I can sign up with email + password, and either create a new organization or join an existing one.**
- [ ] Signup form offers two paths: **"Create a new organization"** (enter org name → new Organization row created, this user becomes its Admin) or **"Join an organization"** (via an invite link/code shared by an existing admin — see A1a). Open signup does not mean "join any org by guessing" — joining always requires a valid invite token, only *account creation itself* is open.
- [ ] Password hashed with Argon2id before storage; plaintext never touches the DB or logs.
- [ ] Signup requires a valid email format and a password meeting a minimum strength bar (8+ chars).
- [ ] A verification email is sent; write access (creating jobs, candidates, etc.) is blocked until the email is verified. Read access to own dashboard is allowed pre-verification with a visible "verify your email" banner.
- [ ] Duplicate email signup returns a generic "check your email" message — never confirms/denies whether an account exists (prevents user enumeration). Email is globally unique across the whole system (one email = one org membership in v1, to avoid the complexity of one person belonging to multiple orgs).

**A1a. As an admin, I can invite teammates into my organization.**
- [ ] Admin generates an invite link containing a single-use, expiring token scoped to their `organization_id` and a pre-set role (recruiter or interviewer).
- [ ] Visiting the invite link pre-fills the signup form's "Join an organization" path and locks the org + role — the invitee cannot self-select a different org or elevate their own role.
- [ ] Invite tokens expire (e.g., 7 days) and are single-use, same hashed-at-rest treatment as password reset tokens.

**A2. As a returning user, I can log in and stay logged in across a browser session.**
- [ ] On successful login, a session is created and set as an `httpOnly`, `Secure`, `SameSite=Lax` cookie.
- [ ] Session ID rotates on login and on any privilege change (e.g., role change by an admin).
- [ ] Failed login attempts are rate-limited to ~5 per 15 minutes per IP+account, with exponential backoff.
- [ ] Wrong password and non-existent email return the identical error message.

**A3. As a user, I can reset a forgotten password.**
- [ ] Reset flow issues a single-use token, hashed at rest, 15–30 min TTL, invalidated after first use.
- [ ] No plaintext password is ever emailed.
- [ ] Reset endpoint is rate-limited like login.

**A4. As an admin, I can assign roles to users so access matches their job.**
- [ ] Only an admin can change another user's role.
- [ ] Role changes take effect immediately and force session rotation for the affected user.
- [ ] Every route independently re-checks the current role server-side — no route trusts a role cached on the client or embedded in an old token.

### Epic B — Jobs (CRUD)

**B1. As a recruiter, I can create a job requisition.**
- [ ] Required fields: title, department, employment type. Optional: description, salary range.
- [ ] New job defaults to status `draft`.
- [ ] Returns the created record (with server-generated ID + `created_at`) so the client doesn't need a second GET.

**B2. As a recruiter, I can view, edit, and close a job.**
- [ ] Job list is paginated (default 25, max 100), server-side searchable by title/department, sortable by created date.
- [ ] Editing a job that has active applications does not orphan or corrupt those applications.
- [ ] Closing a job (status → `closed`) is a soft state change, not a delete — historical applications remain visible.

**B3. As an admin, I can delete a job.**
- [ ] Only admin role can hard-delete; recruiters can only close.
- [ ] Deleting a job with applications requires an explicit confirm step naming how many applications/candidates will be affected (cascade is soft-delete on applications, not hard-delete).

### Epic C — Candidates & Applications (the pipeline)

**C1. As a recruiter, I can add a candidate and apply them to a job.**
- [ ] A candidate record can exist independently, but in v1 scope a candidate is always created *in the context of* applying to a specific job (simplifies the model vs. Lever's freestanding CRM — see research.md).
- [ ] Required: name, email. Optional: resume link, source (referral/job board/etc.).
- [ ] Creates an `Application` joining candidate + job at initial stage `applied`.

**C2. As a recruiter, I can see the pipeline as a kanban board and move candidates between stages.**
- [ ] Columns = pipeline stages (Applied → Screen → Interview → Offer → Hired / Rejected).
- [ ] Drag-and-drop (or equivalent accessible control — see UX note below) moves an application to a new stage.
- [ ] Each card is color-coded by "who needs to act next" (inspired by Greenhouse — see research.md): action needed by recruiter, action needed by interviewer (scorecard pending), or waiting on candidate.
- [ ] Moving a candidate INTO the `Interview` stage without an assigned interviewer is blocked with an inline error — you can't interview nobody.
- [ ] Moving a candidate OUT of `Interview` stage requires the assigned interviewer's scorecard to be submitted first (server-enforced, inspired by Ashby — see research.md). Attempting to bypass this via direct API call is rejected with a 403, not just hidden in the UI.

**C3. As a recruiter, I can search and filter candidates/applications.**
- [ ] Server-side search (debounced ~300ms client-side) across candidate name/email, backed by a DB index — not client-side array filtering.
- [ ] Filters (stage, job, source) combine with AND semantics and are mirrored into the URL query string, so a filtered view is shareable/bookmarkable and survives back-button navigation.
- [ ] "No results for this filter" (with a one-click reset) is visually distinct from "no candidates yet."

**C4. Accessibility note on drag-and-drop (WCAG requirement):**
- [ ] Every stage-move achievable via drag-and-drop must also be achievable via keyboard (e.g., a per-card "Move to..." menu triggered by Enter, with arrow-key stage selection) — drag-and-drop alone fails the "keyboard is a first-class input" bar from the UI/UX spec.

### Epic D — Interviews & Scorecards

**D1. As a recruiter, I can schedule an interview and assign an interviewer.**
- [ ] Required: application (candidate+job), assigned interviewer (must be a User with role interviewer or above), scheduled datetime.
- [ ] Assigned interviewer receives... (v1: appears on their dashboard; email notification is a stretch goal, not core scope).

**D2. As an interviewer, I can submit a scorecard for my assigned interview.**
- [ ] Interviewer can only see/submit scorecards for interviews assigned to them — enforced server-side at the row level (not just hidden in UI).
- [ ] Scorecard fields: structured rating (e.g., 1–4 scale) per a small fixed set of competencies + free-text notes.
- [ ] Once submitted, a scorecard is immutable (append a revision rather than allowing silent edits) — this matters for the "defensible hiring record" spirit of the category.
- [ ] Until the current interviewer submits their own scorecard, they cannot see other interviewers' scorecards for the same application (inspired by Lever's anti-anchoring pattern — see research.md).

### Epic E — Dashboard

**E1. As any logged-in user, I land on a dashboard that's useful on day one (no empty state by default).**
- [ ] Recruiter/Admin dashboard: open jobs count, applications-needing-action count, recent pipeline activity feed.
- [ ] Interviewer dashboard: their upcoming interviews, pending scorecards.
- [ ] All async sections resolve to loading (skeleton) → empty (with CTA) → error (retry button) → success — no blank flash in between, per the UI/UX spec.

---

## 4. Data Shapes (draft — to be finalized as SQL migration + Zod schema in Milestone 3)

```
Organization
  id           uuid, pk
  name         text, not null
  created_at   timestamptz, not null

InviteToken
  id                 uuid, pk
  organization_id    uuid, fk -> Organization.id, not null
  token_hash         text, not null      -- hashed at rest, like password reset tokens
  role               enum('recruiter','interviewer'), not null
  expires_at         timestamptz, not null
  used_at            timestamptz, nullable
  created_by         uuid, fk -> User.id, not null

User
  id             uuid, pk
  organization_id uuid, fk -> Organization.id, not null
  email          text, unique, not null      -- globally unique; one email = one org in v1
  password_hash  text, not null              -- Argon2id
  role           enum('admin','recruiter','interviewer'), not null, default 'interviewer'
  email_verified boolean, not null, default false
  created_at     timestamptz, not null
  updated_at     timestamptz, not null

Job
  id              uuid, pk
  organization_id uuid, fk -> Organization.id, not null
  title           text, not null
  department      text, not null
  status          enum('draft','open','closed'), not null, default 'draft'
  description     text, nullable
  created_by      uuid, fk -> User.id, not null
  created_at      timestamptz, not null
  updated_at      timestamptz, not null

Candidate
  id              uuid, pk
  organization_id uuid, fk -> Organization.id, not null
  name            text, not null
  email           text, not null
  resume_url      text, nullable
  source          enum('referral','job_board','direct','other'), not null, default 'other'
  created_at      timestamptz, not null

Application
  id              uuid, pk
  organization_id uuid, fk -> Organization.id, not null   -- denormalized for defense-in-depth row checks
  candidate_id    uuid, fk -> Candidate.id, not null
  job_id          uuid, fk -> Job.id, not null
  stage           enum('applied','screen','interview','offer','hired','rejected'), not null, default 'applied'
  deleted_at      timestamptz, nullable   -- soft delete on job cascade
  created_at      timestamptz, not null
  updated_at      timestamptz, not null
  UNIQUE(candidate_id, job_id)

Interview
  id              uuid, pk
  organization_id uuid, fk -> Organization.id, not null
  application_id  uuid, fk -> Application.id, not null
  interviewer_id  uuid, fk -> User.id, not null
  scheduled_at    timestamptz, not null
  created_at      timestamptz, not null

Scorecard
  id            uuid, pk
  interview_id  uuid, fk -> Interview.id, not null, unique
  submitted_by  uuid, fk -> User.id, not null
  ratings       jsonb, not null   -- { competency: 1-4, ... }
  notes         text, nullable
  submitted_at  timestamptz, not null
```

**Why `organization_id` is denormalized onto Application/Interview even though it's derivable via Job/Candidate:** a row-level authorization check should be a single indexed `WHERE organization_id = $1` comparison, not a multi-table join computed fresh on every request — cheaper, faster, and harder to get subtly wrong under time pressure. `Scorecard` doesn't need its own `organization_id` since it's always accessed through its parent `Interview`.

**Indexes to add at migration time:** `Application(organization_id, job_id, stage)` composite for pipeline queries, trigram/full-text index on `Candidate(organization_id, name, email)` for search, `Interview(interviewer_id)` for "my interviews" queries, `User(organization_id)` and `Job(organization_id)` for tenant-scoped listing.

**Nullable fields flagged for review:** `Job.description` (nullable — a job can exist before its full description is written) and `Scorecard.notes` (nullable — ratings alone are a valid minimal scorecard) are the only two intentionally-nullable fields; everything else is required by design.

---

## 5. Edge Cases

- Candidate applies to the same job twice → blocked by `UNIQUE(candidate_id, job_id)`, surfaced as a friendly "already in this pipeline" error, not a raw constraint violation.
- Job is closed while it still has candidates in `interview` stage → allowed, but the UI should surface a warning; closing does not auto-reject in-flight candidates (recruiter must explicitly reject or hire each one).
- Interviewer assigned to an interview is later demoted/deleted → interview keeps a record of who was assigned (don't cascade-delete interviews); if the user is deleted, `interviewer_id` should be handled via a "reassign or archive" flow rather than a null FK.
- Two recruiters try to move the same candidate to different stages simultaneously → last-write-wins is acceptable for v1, but the mutation response returns the authoritative current state so the client reconciles instead of trusting its optimistic update blindly.
- Search query matches zero candidates vs. zero candidates existing at all → must render different empty states (see C3).

---

## 6. Serverless Architecture Implications (Vercel functions)

Deciding to run Express as a Vercel serverless function (via `serverless-http` wrapping the existing Express app in a single `/api/index.js` catch-all) changes several things from a "traditional" Express deploy:

- **No in-memory state survives between requests.** Sessions cannot live in server memory (no `express-session` MemoryStore) — sessions are stored in Postgres (a `sessions` table, session ID in the httpOnly cookie is just a lookup key) so any function instance can validate any session.
- **Rate limiting needs the same treatment.** Login/reset rate limits (5 attempts/15 min) are tracked in Postgres (a simple `attempt_count` + `window_start` per IP+account row, checked and incremented atomically) rather than an in-memory token bucket, since two concurrent function instances don't share memory.
- **DB connection pooling matters more.** Serverless functions can spawn many concurrent short-lived connections; we'll use a pooled Postgres provider (Neon or Supabase, both pool-aware) rather than a raw long-lived `pg.Pool` sized for a traditional server.
- **Cold starts are a real UX factor**, not just an infra footnote — the loading states from the UI/UX spec (skeletons, not spinners) matter even more here since a cold start can visibly delay first response.
- **CORS** needs explicit configuration since frontend and API, even if deployed from the same Vercel project, may still be served from different execution contexts depending on final routing setup — confirmed during Milestone 4.

## 7. Explicit Assumptions (flag before coding)

1. A "candidate" is scoped to one application in v1 — no cross-job candidate CRM/reuse (deliberate simplification vs. Lever's model; documented in research.md).
2. Email verification, password reset, and org invites use a real transactional email provider (e.g., Resend/Postmark free tier) — not console-logged tokens, since production auth needs to actually work per the deployment checklist.
3. OAuth (Google/GitHub) is **not** in v1 core scope — email+password only, to keep the auth surface small enough to review thoroughly in a 7–14 day window, especially given multi-tenancy is already adding real complexity. Can be a bonus-points addition if time allows.
4. CSV export (Beyond Basics requirement) targets the Applications/pipeline view first, since that's the highest-value export for a recruiter — and will be scoped to the exporting user's organization only, obviously.
5. Given multi-tenancy is now in scope, **cross-org features are explicitly out of scope**: no shared candidate pools across organizations, no org-to-org comparisons, no platform-level admin panel. The tenant boundary is hard and total.
6. "Interviewer" accounts are always invite-only (via A1a) — the "open signup" decision applies to *creating a new organization as its first admin*, not to joining an arbitrary existing one.

---

## 8. Scope-Control Decisions (resolved)

These were open questions in the previous draft — now decided:

1. ~~Open signup or invite-only?~~ → **Open signup for new-org creation; invite-only for joining an existing org.**
2. ~~Single-tenant or multi-tenant?~~ → **Multi-tenant.** This is the biggest scope/timeline risk in the plan — mitigated by keeping the tenancy model as simple as possible (one email = one org, no cross-org anything, org_id denormalized everywhere for cheap enforcement rather than clever query composition).
3. ~~Hosting split?~~ → **Vercel serverless functions** for both API and frontend. See §6 for what this changes architecturally — sessions and rate-limiting move from "in-memory, trivial" to "Postgres-backed, needs its own small design pass" in Milestone 3.

**One remaining recommendation given the two ambition-increasing choices:** consider treating Milestone 3 (schema + auth) as the highest-risk milestone and giving it proportionally more of the timebox — auth + multi-tenancy + serverless statelessness are three compounding sources of subtle bugs (session handling, rate-limit races, org-scoping leaks) that are much cheaper to get right in the schema/middleware layer than to patch later.

---

*Per the handbook's AI workflow: no implementation code should be written until this plan is reviewed and approved.*
