# Research: Category Leader Analysis

**Product:** Sift (working name) — Applicant Tracking System
**Category leaders studied:** Greenhouse (established leader), Lever (fast-moving challenger), Ashby (modern/adjacent outlier)
**Method:** Public product pages, G2/Capterra reviews, third-party comparison reviews, help-center docs. Screenshots, stopwatch onboarding timing, and live-account walkthroughs still need a hands-on pass — see "Still To Do" at the bottom.

---

## 1. Greenhouse — the established leader

**Positioning:** structured, compliance-heavy hiring for orgs that want consistency and defensibility in hiring decisions (strong DEI/bias-reduction angle).

**Interaction model:**
- Core object is the **Visual Candidate Pipeline** — a kanban board where each interview stage is a column, candidates are cards, and color-coding (red/yellow/gray) signals *whose turn it is to act* rather than just "what stage." Red = internal action needed, yellow = scorecard pending, gray = waiting on candidate/scheduled.
- Drag-and-drop to advance candidates; users with permission only.
- Interface is explicitly segmented by role: recruiter (task-oriented, dense), hiring manager/interviewer (lightweight, scorecard-only).

**Information hierarchy:**
- Recruiter dashboard: open requisitions → pipeline health → pending tasks, in that order of prominence.
- Candidate profile is the hub: consolidates communication, feedback, scheduling in one view rather than tabs per concern.

**Pattern worth stealing:** the **status-by-color, not status-by-stage-name** idea — a card's color tells you who owns the next action, which is more actionable than just showing "Stage: Phone Screen."

**Pattern to avoid copying directly:** Greenhouse's learning curve is repeatedly cited as "moderate to steep" for anything beyond daily use (custom reporting, workflow config). For a trial-task scope, that's a signal to keep configuration simple and defaults sane rather than exposing power-user complexity everywhere.

---

## 2. Lever — the fast-moving challenger

**Positioning:** ATS + CRM fusion — treats candidates (including passive ones who haven't applied yet) as long-term relationships, not just applicants in a pipeline.

**Interaction model:**
- Also kanban-style pipeline, consistently described as "clean" and lower learning curve than Greenhouse.
- Two top-level sections: **People** (candidate-centric, works across jobs) vs. **Jobs** (requisition-centric). This dual-entry navigation is Lever's signature IA choice — you can browse by person or by role.
- A small but notable UX decision: interviewer feedback is **hidden until you submit your own** — this reduces anchoring bias in scorecards.

**Information hierarchy:**
- Real-time dashboards foreground time-to-hire, conversion rate, and pipeline progression — metrics-first for managers, task-first for recruiters (similar split to Greenhouse but less rigidly enforced).

**Pattern worth stealing:** the **hide-others'-feedback-until-you-submit-yours** pattern for scorecards is a small, cheap, high-value interaction — directly implementable and a nice "detail that proves you thought about it" for the evaluation rubric's Originality criterion.

**Pattern to avoid copying directly:** the People/Jobs dual-navigation is elegant but adds real complexity (a candidate needs to be resolvable independent of any one job). Given our medium-ambition scope (3–4 entities), we're deliberately simplifying to job-centric navigation only — candidates exist through their application to a specific job, not as a freestanding CRM record.

---

## 3. Ashby — the modern/adjacent outlier

**Positioning:** "AI-native," analytics-forward ATS built for technical/high-growth teams; consistently described as faster and more modern-feeling than Greenhouse or Lever, at the cost of being denser/more configurable (a double-edged sword — some reviews call it best-in-class intuitive, others call it overwhelming for casual users).

**Interaction model:**
- Single unified data model — ATS, CRM, scheduling, and analytics share one underlying object graph rather than being bolted together, which is why cross-cutting reports (e.g. source → hire) work natively instead of requiring joins.
- Scorecard submission is **enforced**, not optional, before a candidate can be advanced — structure is a hard gate, not a suggestion.
- Notably fast page loads / near-instant navigation is repeatedly cited as a differentiator — performance itself is treated as a UX feature.

**Information hierarchy:**
- Seven "core dashboard templates" ship by default, functioning as a starting point rather than a blank slate — reduces the empty-dashboard problem for new users.
- Custom report/dashboard builder for anyone who outgrows the defaults.

**Pattern worth stealing:** **enforced scorecard-before-advance** is a clean RBAC + data-integrity rule we can implement directly (an interviewer literally cannot move a candidate stage without submitting feedback first) — this also happens to be a great demonstration of server-side authorization logic for the trial's evaluation criteria.

**Pattern to avoid copying directly:** the multi-role dashboard templates and BI-style custom report builder are enterprise-scale — out of scope for a 7–14 day build. We'll take the *idea* (a dashboard should never be empty on day one) and implement it as a single well-designed default dashboard, not a template picker.

---

## Cross-cutting patterns to adopt in Sift

| Area | Decision for Sift | Inspired by |
|---|---|---|
| Pipeline view | Kanban board, stage = column, candidate = card | All three |
| Card status signal | Color-code by "who needs to act next," not just stage name | Greenhouse |
| Scorecard gating | Server-side rule: candidate cannot advance stage without a submitted scorecard from the assigned interviewer | Ashby |
| Feedback bias reduction | Hide other interviewers' scorecards until the current user submits their own | Lever |
| Navigation | Job-centric only (no freestanding candidate CRM) — deliberately simpler than all three leaders | Simplification of Lever |
| Dashboard | One well-designed default view (open jobs, pipeline health, recent activity) — no empty state on day one | Ashby |
| Role segmentation | Recruiter/Admin = full pipeline management; Interviewer = scoped to assigned candidates + scorecard only | Greenhouse |

## Still to do (requires a live hands-on pass — not fully deferrable to research)
- [ ] Sign up for Greenhouse, Lever, and/or Ashby free trials/demos and time actual onboarding-to-first-value with a stopwatch.
- [ ] Screenshot the 3–4 critical flows (create job, move candidate, submit scorecard) at desktop + mobile widths.
- [ ] Screen-record a pipeline drag-and-drop interaction at 60fps to extract real easing/duration values (handbook suggests starting point of 150–250ms ease-out — confirm against what these products actually do).
- [ ] Skim each product's changelog/help center for vocabulary conventions (e.g., do they say "stage" or "step"? "scorecard" or "evaluation"?) to keep Sift's copy consistent and considered.

## Originality note (per handbook guidance)
Nothing above references layout pixels, brand colors, logos, or copy — only interaction *patterns* (kanban pipelines, color-coded status, gated scorecards) which are shared conventions across the category, not any one company's IP. Sift's visual identity, naming, and copy will be built independently in the design phase.
