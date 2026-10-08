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
| **W5** | Referral recommendation: `ReferralRulesService` (rules as data), structured output + **evidence verifier**, cardiology/neurology guideline docs in the knowledge base, doctor chat "review this patient" + Review button. Must NOT refer on old history alone | ✅ |
| W6 | Approval layer: `agent_actions` entity, tiers (AUTO/ASK/ASK+human/NEVER), executor as the approving user with re-validation, idempotency, read-back verification, expiry, approval card UI, action audit, guardrail "say done only if DONE" (design in `AGENT_UPGRADE_PLAN.md`) | **next** |
| W7 | `consultation_requests` (referrals) + status machine, persisted per-user notifications (socket room `user:<id>`), notification rules, `patient_notices` stub adapter, header notification centre | ⬜ |
| W8 | Specialist portal: my consultations, AI referral summary, complete-consultation form, chat with SPECIALIST tool set. Specialists currently see **no patient data** (access arrives with referrals) | ⬜ |
| W9 | Follow-up plan proposals, minimal `lab_orders`, visit → FOLLOW_UP → COMPLETED | ⬜ |
| W10 | Agent run view: goal, context, decisions, action ids; acceptance/decline metrics | ⬜ (context hash/snapshot already stored) |
| W11 | RAG: hybrid search, metadata filters, rewriting, rerank, citation spans, RAG eval set (after M4) | ⬜ |
| W12 | Agent eval suite (scenario runner with fixtures, targets in backlog §W12) | ⬜ (grows each package; context checks already in `tests/evaluation/evaluator.ts`) |
| W13 | Hardening: CI, provider failover, streaming, cookies/MFA, purge on delete, split `AiService` | ⬜ |
Milestones: M1 ✅ (visit lifecycle), M2 = W4–W5 recommendation with evidence, M3 = W6–W7 approval + referral + notifications, M4 = W8 specialist loop.

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
npm run test:eval                         # 123 scripted checks + baseline.json regression gate (tests/evaluation)
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
