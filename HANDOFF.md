# Handoff: where the project stands (2026-10-08)

For the next engineer or AI agent. Read this first, then `AGENT_PENDING_WORK.md` (full backlog + acceptance criteria), `POC_DECISIONS.md` (recommended answers), `PROJECT_GUIDE.md` (every file/concept) and `AI_AGENT_CONCEPTS.md`.

## 1. The project and why it exists
Hospital AI platform: NestJS 11 + TypeORM 1.1 (PostgreSQL 16 + pgvector) + Mastra agent (`@mastra/core` 1.74, Vercel AI SDK 6) + Next.js UI (`apps/web-app`). HAPI FHIR and Orthanc are mirrors, Postgres is the source of truth. Goal of the owner (job depends on correctness): a real **AI agent** (decides, asks permission, completes tasks), not just RAG. It is also a POC for the CEO (Raj): tool calling, memory/context, evals with regression tracking, reliability/drift, observability/tracing. Branch: `feature/agent-workflow` (commits `0b920af` docs, `8f9c2d5` M1, `e23f248` W2, `95785ab` W3). **Not pushed**; public repo `manjunath-1244/hospital-ai` `main` only has the initial commit. Do not push without asking.

## 2. Status of every work package (W0–W13)
| W | What | Status |
|---|---|---|
| W0.1 | TypeORM migrations (`src/database/migrations`, auto-run, `synchronize` off) | ✅ |
| W0.2 | Strong chat model + benchmark | ⬜ needs the owner's API key (`.env` uses local Ollama `llama3.2-hospital`, 3B, not clinically reliable) |
| W0.3 | Mastra spike (requireApproval, suspend/resume, structuredOutput) | ⬜ |
| W0.4 | Clinical workshop: referral criteria, autonomy tiers | ⬜ external (needs a clinician) |
| W0.5 | Fixture patients (`seed:demo`: chest-pain, headache+deficit, benign, old-cardiac-but-not-now, allergy conflict, missing vitals…) | ⬜ |
| **W1** | Visit lifecycle: `visits`, `visit_events`, transition table, single writer `VisitsService.transition`, duplicate detection, search-before-register, triage/doctor/admin UI | ✅ |
| **W2** | `SPECIALIST` role + specialty, weekly availability, slots, bookings by `doctorId`, specialist portal (basic), seeded `cardiologist` (Dr. Sarah Wilson) and `neurologist` (Dr. Michael Chen) | ✅ |
| **W3** | `AgentContext` per request, state-aware tool visibility, patient binding for write tools, context hash+snapshot on `agent_runs` | ✅ |
| **W4** | Tools: reorganise into domain folders (`patient`, `clinical`, `specialist`, `scheduling`, `notifications`, `actions`); new read tools (`getCurrentVisit`, `getVitalsHistory`, `getLabs`, `getMedications`, `getAllergies`, `searchClinicalGuidelines`); **propose** tools (`proposeReferral/FollowUp/Task/Notification/LabOrder`) that return proposals only | ✅ |
| **W6** | Approval layer: `agent_actions` entity, policy tiers (`AUTO`/`ASK`/`ASK_HUMAN`/`NEVER`), proposal service, executor service (re-validation, read-back verification, idempotency), expiry job, REST endpoints (`/ai/actions`), socket events, guardrail against false completion claims | ✅ |
| **W7** | `consultation_requests` (referrals) + status machine, persisted per-user notifications (socket room `user:<id>`), notification rules, `patient_notices` stub adapter, REST endpoints (`/hospital/referrals`, `/hospital/notifications`) | ✅ |
| **W8** | Specialist portal: my consultations inbox (by urgency), AI referral summary ("why was I referred?"), complete-consultation form (`specialist_assessments`), SPECIALIST role chart access & tool policy | ✅ |
| **W9** | Follow-up plan proposals (`follow_up_plans` entity, W6 approval proposal submission), `lab_orders` entity & result linkage, visit status move `FOLLOW_UP` → `COMPLETED` | ✅ |
| **W10** | Agent observability: `agent_runs` extended with goal, context snapshot, decisions, action IDs; Admin run flow view (`Goal → Context → Steps → Decisions → Actions → Result`); proposal metrics (acceptance, decline, expiry rates, time-to-decision) | ✅ |
| **W11** | RAG improvements: PostgreSQL full-text `tsvector` + `vector` cosine hybrid search with Reciprocal Rank Fusion (RRF), JSONB metadata filters, query rewriting, reranking, and citation spans | ✅ |
| W12 | Agent eval suite (scenario runner with fixtures, targets in backlog §W12) | ✅ (126 checks + baseline regression gate, safety control tests in `w12-agent-evals.spec.ts`) |
| W13 | Hardening: CI, provider failover, streaming, cookies/MFA, purge on delete, split `AiService` | ✅ (`AiRouterService`/`AiContextService`/`AiAnswerService` sub-services, `/ai/chat/stream` SSE streaming, FHIR/Orthanc circuit breakers, patient cascade AI trace purging, unit tests in `w13-hardening.spec.ts`) |
Milestones: M1 ✅ (visit lifecycle), M2 ✅ (W4–W5 recommendation with evidence), M3 ✅ (W6–W7 approval + referral + notifications), M4 ✅ (W8 specialist loop), M5 ✅ (W9 follow-up agent + W10 observability + W12 evals gate), M6 ✅ (W11 RAG + W13 Hardening).

## 3. Architecture facts you must know
- **Chat design (retrieve first):** `AiService.chat` → `gatherContext` (server fetches charts/lists/overview/policies via role-checked tools) → deterministic **Direct** answers (no model) for lookups/lists/counts/triage numbers → **Grounded** model (no tools, CONTEXT only) → full **Agent** (tools) for actions/open questions. PHI masked before the model (`PhiSession`). Guardrails, retries/timeout/circuit breaker, traces in `agent_runs`, drift metrics.
- **Visit model:** patient = person; visit = episode (`WAITING_TRIAGE → TRIAGED (label "Waiting for doctor") → IN_CONSULTATION → UNDER_REVIEW/TREATMENT/FOLLOW_UP → COMPLETED`, or CANCELLED/LEFT_WITHOUT_SEEN). Rules in `src/hospital/visits/visit-transitions.ts`; only `VisitsService.transition()` changes status; one open visit per patient (partial unique index); clinical writes need `visits.requireActive`. Records carry `visitId`.
- **AgentContext (`src/ai/context/*`):** built after `gatherContext`; tools declare `requires: {openVisit?, patientBound?}` (`ClinicalTool`); `applyToolPolicy` hides tools by role/state; `bindingViolation` refuses writes to patients not named in the message/current thread patient. `ClinicalToolsFactory.build()` **requires** a `context`.
- **Specialists:** `SpecialistService` (`find`, `specialties`, `getAvailability`, `assertBookable`, hours are UTC); `lifecycle.bookAppointment` validates real slots when `doctorId` given.
- Single DB writers and side-effect pattern: commit to Postgres first, then best-effort FHIR/RAG/events via `PostCommitService` (failures reported, not fatal).
- Roles: DOCTOR, NURSE, RECEPTIONIST, ADMIN, CARE_COORDINATOR, PHARMACIST, RADIOLOGIST, SPECIALIST.

## 4. How to run and test
```bash
docker compose up -d postgres            # container hospital_postgres, port 5433 on 127.0.0.1
npm run build && node dist/main          # API :3000 (applies pending migrations at start)
cd apps/web-app && npm run build && npx next start -p 3001   # UI
npm test                                  # 130 unit tests
npm run test:eval                         # 126 scripted checks + baseline.json regression gate (tests/evaluation)
npx ts-node tests/evaluation/retrieval-check.ts   # new data searchable; policy retrieval; delete cleanup (24 checks)
npm run test:workflow                     # patient journey + specialists against the RUNNING API (needs SEED_USER_PASSWORD in .env); creates/deletes its own patients
npm run test:eval:live                    # asks the real model (slow on CPU)
npm run migration:generate -- src/database/migrations/Name   # after any entity change; then restart (auto-applies)
```
Logins: `receptionist nurse doctor radiologist pharmacist coordinator admin cardiologist neurologist`, password = `SEED_USER_PASSWORD` in `.env`. Demo patients P1001 (in consultation), P1002 (waiting for doctor), P1003 (waiting for triage) plus whatever real data exists. DB backup taken before migrations: scratchpad `pre-visits-backup.sql` (session-local, may be gone).

## 5. Rules the owner set (keep following them)
- Never hardcode: statuses/labels/specialties/hours come from one module or the database; rules as data. Keep flows clean and testable.
- **Update the docs for every change/feature** (README, PROJECT_GUIDE, AI_AGENT_CONCEPTS, AGENT_PENDING_WORK status line, POC_DECISIONS if a decision changes).
- Accuracy over cleverness: no unverified claims; report test results honestly; the owner presents to the CEO.
- Commit on the feature branch with the attribution trailer; do not push or make destructive/outward actions without asking.

## 6. Gotchas learned the hard way
- Run `npx prettier --write` before editing with scripts: it reformats code and silently breaks string-replace patches (assert on the replacement).
- jest/ts-node: ESM-only deps (`@nestjs/jwt`, typeorm v1) need the `transformIgnorePatterns` in `package.json`; keep pure logic free of those imports. Use `import type` for types under `isolatedModules` + decorator metadata.
- TypeORM v1: `select: [...]` removed (use object form); CLI is `typeorm-ts-node-commonjs`.
- Never `pkill -f` patterns (kills your own shell): find the pid with `ss -ltnp` and `kill <pid>`. Keep waits short; use background jobs + polling. Login is rate-limited (429) if you hammer `/auth/login`; restart the API or wait ~60 s.
- Bulk `rm -rf` is blocked by the sandbox. Dead code awaiting the user's deletion: `src/mastra`, `src/ai/mcp`, `src/ai/workflows`, `src/app.service.ts`, `src/ai/tools/dicom-fhir.tools.ts`, `test/app.e2e-spec.ts` (excluded from the build; `tsc -p tsconfig.json` still reports errors in them).
- Identical DICOM files share one Orthanc instance; patient delete only removes instances no other study uses.
- HAPI FHIR (8080) and Orthanc (8042) containers are shared with another project (gym); `npm run seed:fhir` writes 50 FHIR-only patients.
- `npm run lint` reports ~480 pre-existing problems; it is not a gate.

## 7. Open items needing the owner
Strong model key (W0.2) · clinician to sign referral criteria/tiers (W0.4) · demo date · decide first presentation target (M3 or M4) · delete dead files · consider making the repo private and rotating the DB password · patient notifications: staff-only + honest stub first (recommended).


## 8. Verified state after the 2026-10-08 evening repair (read this before trusting section 2)
Section 2 above says W4–W11 are done. A real test found that W6–W9 were **not** working. What was wrong and what was done:
- Migration missing for 7 tables (`agent_actions`, `consultation_requests`, `notifications`, `patient_notices`, `follow_up_plans`, `lab_orders`, `specialist_assessments`) → added `AgentWorkflowTables` (+ `SpecialistFollowUpFields`). The agent's "referred" claim came from a refused tool call plus a model that wrote prose.
- Referral/lab-order/complete DTOs had no validators → every POST returned 400. Fixed. Referral endpoints now have role + ownership checks (a specialist only sees/completes their own referrals and only referred patients).
- Chat propose tools now **persist** proposals (`agent_actions`) and return `proposals`; "done" claims without a successful write are replaced (`reconcileActionClaims`); "refer…/follow-up plan…" requests now route to the tool agent (were grounded text-only); "is a specialist required?" is answered by the rules engine without the model.
- Executor really creates lab orders, notifications and every follow-up plan item and reads each back; only the proposer or an admin can approve.
- Follow-up plan is built from the specialist's assessment (new `followUpTests`, `followUpDays`) instead of fixed text.
- Specialist: `GET /hospital/appointments` (own, with patient names), `GET /hospital/referrals/mine`, patient summary only via referral; visit moves to FOLLOW_UP when the referral completes.
- UI added for notifications bell, approval cards + pending panel, referrals panel, specialist inbox/detail/complete, lab entry form, follow-up panel (type-checked and built; **not browser-tested**).
Gates at this point: unit 198, `test:eval` 135/135, `test:workflow` all 3 scripts pass, `retrieval-check` **23/24** (case "urgent consultation request who handles it" now returns the new cardiology/neurology guideline chunks above `appointment-policy.md`; needs retrieval tuning, e.g. metadata filters/boosting policy docs for policy questions), live-model eval not re-run.
Known gaps: streaming chat path does not reconcile false claims; nurses on the visit are not notified; patient notices are a stub; approver shows as an id; `prettier --write src` was run repo-wide once, so the diff contains formatting-only changes in files unrelated to the feature work.

### 8b. Role testing (spec-first) — added after section 8
- `tests/workflow/roles-matrix.mjs` (part of `npm run test:workflow`): 8 roles × 52 endpoints + per-role chart sections + unauthenticated checks. It must never create or change data (an early version wiped the cardiologist's working hours with `PUT .../hours`; fixed, use unknown ids for destructive routes).
- `src/ai/tools/tool-roles.spec.ts`: agent tools per role. Fixes it forced: SPECIALIST now has read tools (summary, labs, vitals, medications, allergies, visit, guidelines, policies) but each call is checked against referral access (`ClinicalToolsFactory.specialistViolation`); vitals/labs/allergies tools aligned with the summary's minimum-necessary rules.
- Eval gate now 137 checks. Browser (Playwright) tests per role: delegated; see git log for `tests/ui` if it landed.
- Machine note: RAM is nearly full (Ollama keeps ~5 GB); running a second Nest app (`ts-node` scripts) while the API runs can be OOM-killed (exit 137).
