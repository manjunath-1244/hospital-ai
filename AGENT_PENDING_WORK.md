# Pending work: turning the hospital app into a workflow-driven AI agent

> **What this is:** the checked gap analysis of the proposed *workflow-first* plan (reception → nurse → doctor → AI review → specialist → follow-up) against **this codebase**, followed by the complete backlog of work still to do.
> **Relation to other documents:** [`AGENT_UPGRADE_PLAN.md`](AGENT_UPGRADE_PLAN.md) (approval layer, autonomy tiers, task evals) is **reused as work package W6** below; its ordering is superseded by this document because it started at the agent instead of at the hospital workflow. [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) describes what exists today.
> **Checked on:** 2026-10-08, against the repository at commit `9e8f875` plus local documentation changes.

---

## 1. Verdict on the proposed plan

**Agree (adopt):**
1. **Workflow first, agent second.** The agent needs a real patient/visit lifecycle to reason about; today it has none.
2. **An explicit `AgentContext`** (who, which patient, which visit, which stage, what is allowed).
3. **Specialist routing as the flagship demo** (recommend → human confirms → consultation created → notifications → specialist portal → follow-up).
4. **Human approval + full audit** of every agent action.
5. **Deterministic backend for deterministic things** (auth, writes, calculations, notification delivery); the agent only orchestrates.
6. **Separate RAG evals and agent evals**, and improving RAG *after* the workflow works. (Our RAG already passes its checks, so this order is safe.)

**Adjust (my recommendations):**
| Proposed | Adjustment | Why |
|---|---|---|
| Ten patient states in one lifecycle (`SPECIALIST_REQUIRED`, `SPECIALIST_CONSULTATION` …) | Keep a **Visit** lifecycle for the hospital stay, and model specialist steps as **separate `consultation_requests` (referrals)** with their own status. The visit shows a *derived* "awaiting specialist" while any referral is open. | A visit can have several referrals at once (cardiology **and** neurology). One linear state cannot represent that. |
| New roles `CARDIOLOGIST`, `NEUROLOGIST` | One role **`SPECIALIST`** plus a **`specialty`** attribute on the user | Avoids a new role (and new permission code) for every specialty |
| Restructure `src/` into `hospital/patients|visits|reception|…` and `ai/agent|tools/...` | **Do not restructure now.** Add new modules next to the existing ones; reorganise tools into domain subfolders (small change); move files later if still wanted | A big move creates risk and merge pain while delivering no capability |
| "The agent decides the specialist" | **Decision support**: deterministic referral rules (clinician-approved) + model reasoning that must **cite evidence from the current context**; human confirms | Referral is a clinical decision; a 3B model's unaided "reasoning" is not acceptable |
| Notify the **patient** | Patients have **no accounts or channel** today. Start with staff in-app notifications; add a `patient_notices` record and a pluggable SMS/e-mail adapter (stub first) | Otherwise the plan silently depends on a channel that doesn't exist |
| No mention of schema changes | Introduce **real migrations before the schema grows** | We use `synchronize` only; adding visits/referrals/notifications on top of it is risky |
| Build the agent tools "properly as Mastra tools" | Already true (15 tools); the real gap is **state-aware** tools and **action** tools | |

---

## 2. Gap analysis: target versus today

| # | Target (from the proposed plan) | Today (checked in code) | Gap |
|---|---|---|---|
| 1 | **Visit** concept; a patient can return | None. One `patients` row carries `consultationStatus` (`WAITING`/`SEEN`/`CLOSED`); re-registering creates a new patient | **Missing entity + migration** |
| 2 | Lifecycle (registered → waiting → triaged → consult → review → … → completed) | 3 states. **Triage does not change status** (verified: 0 status updates in `recordTriageAndVitals`) | **Missing state machine** |
| 3 | Receptionist **search, then register**; "already registered?" check | Registration form only; no search/duplicate check in the UI or on create | **Missing** |
| 4 | Nurse picks from waiting list, records vitals/symptoms/glucose, sets priority | Vitals form exists; no glucose/symptoms capture; no priority on the visit; queue shows only `WAITING` | 🟡 **Partial** |
| 5 | Doctor opens patient with an **auto-built context** | `PatientSummaryService` builds a chart; no *visit* context (current complaint/vitals/stage) | 🟡 **Partial** |
| 6 | **`AgentContext`** (user, role, patient, visit, department, clinical data, conversation, permissions) | Pieces exist (`AuthUser`, thread focus, summary); **no such object** | **Missing** |
| 7 | Doctors and **specialists** with specialty and **availability** | `users` has `role` only; appointments store `doctorName` text; no specialty, no availability | **Missing** |
| 8 | `findSpecialist()`, `getSpecialistAvailability()` tools | None | **Missing** |
| 9 | Agent **reasons about specialist need** from current vitals/labs/meds/history/policies | Agent can read chart and policies; no referral reasoning, no rules, no structured recommendation | **Missing** |
| 10 | **Human approval** of high-impact actions | Not implemented (write tools execute directly after a prompt instruction) | **Missing** (design done in `AGENT_UPGRADE_PLAN.md`) |
| 11 | `createConsultation()` for a specialist (a **referral object**) | `consultations` = the doctor's own visit note. No referral/consultation-request entity | **Missing** |
| 12 | **Notifications** to specialist, primary doctor, nurse, patient | Only transient WebSocket events to **role rooms**; nothing persisted; no per-user targeting; no patient channel | **Missing** |
| 13 | **Specialist portal** (my consultations, patients, notifications, AI summary) | None | **Missing** |
| 14 | Specialist records assessment/recommendation/treatment/follow-up → completes → notifies | None | **Missing** |
| 15 | **Follow-up agent** proposes appointment, labs, tasks, patient notice | No follow-up objects; no lab **orders**; appointments/tasks exist (API only, no UI) | **Missing** |
| 16 | **Audit** of every agent action: user, patient, action, timestamp, reason, tool, result | Audit log = HTTP requests only; agent steps live in `agent_runs`; no action/reason record | **Missing** |
| 17 | **Agent observability**: Goal → Context → Tools → Results → Decisions → Actions → Result | Spans for memory/llm/tools exist; **no goal, no context snapshot, no decisions/reasons, no action link** | 🟡 **Partial** |
| 18 | RAG: hybrid search, metadata filters, query rewriting, reranking, compression, citations | Semantic vector search, content hashing, fallback threshold, **citations (file + heading) ✅**; none of the others | 🟡 **Partial** |
| 19 | **RAG evals** | `retrieval-check.ts` (24 checks, pass/fail on known facts); no recall@k / MRR / citation accuracy | 🟡 **Partial** |
| 20 | **Agent evals** (tool choice, specialist choice, correct patient, clarification, unauthorized action, confirmation, execution, notification) | Evals cover tool/data choice, RBAC, memory, reliability, routing; **no** specialist, clarification, confirmation, execution or notification checks | 🟡 **Partial** |
| 21 | Deterministic services stay deterministic | ✅ already the design (NEWS2, safety, lab rules, lifecycle, guards) | ✅ |
| 22 | Memory, guardrails, security, reliability, observability folders | ✅ exist (memory, PHI masking, guardrails, breaker/retry, traces) | ✅ |

**What is already done and reused:** role-checked tools and tool factory · DTO validation for tool writes · retrieve-first routing and direct answers · patient focus memory · PHI masking · reliability wrapper · traces/metrics/drift · eval harness with baseline gate · WebSocket gateway · audit interceptor · patient close/reopen/delete · knowledge upload.

---

## 3. Target design (the pieces to build)

### 3.1 Data model additions
```
visits                id, patientId, status, chiefComplaint, priority(ESI/NEWS2 snapshot), arrivedAt, triagedAt,
                      primaryDoctorId, department, closedAt, outcome            ← NEW (the lifecycle lives here)
users (extend)        + specialty, department, isAvailable                       ← role SPECIALIST added
availability          doctorId, weekday/timeRange (or slots), + existing appointments  ← NEW (or slots table)
consultation_requests id, visitId, patientId, requestedBy, specialty, assignedSpecialistId, urgency, reason,
(referrals)           aiRationale+evidence, status(REQUESTED/ACCEPTED/IN_PROGRESS/COMPLETED/CANCELLED), timestamps
specialist_assessments id, requestId, assessment, recommendation, treatment, followUp, completedAt, authorId
notifications         id, recipientUserId | recipientPatientId, type, payload, readAt, channel, deliveredAt, sourceActionId
follow_up_plans       id, visitId, items[appointment|lab|task|notice], status, createdFromRequestId
lab_orders (minimal)  id, visitId, test, status, orderedBy, resultId
agent_actions         (from AGENT_UPGRADE_PLAN) proposals, approvals, execution, verification
agent_run (extend)    + goal, contextSnapshot(ref), decisions[{what, why, evidence}], actionIds[]
existing tables       + nullable visitId on vitals, labs, imaging_studies, consultations, appointments, staff_tasks
                      (backfill: one visit per existing patient)
```

### 3.2 Visit lifecycle (proposed)
```
REGISTERED → WAITING_TRIAGE → TRIAGED → IN_CONSULTATION → UNDER_REVIEW → TREATMENT → FOLLOW_UP → COMPLETED
                                                  └── (derived) AWAITING_SPECIALIST while any referral is open
                         any state → CANCELLED / LEFT_WITHOUT_SEEN (reception/admin)
```
A `VisitLifecycleService.transition(visit, to, actor)` allows only listed transitions, per role, records who/when, emits an event, and is the **only** way status changes. Triage moves `WAITING_TRIAGE → TRIAGED`; the doctor's first consultation moves to `IN_CONSULTATION`; closing sets `COMPLETED`.

### 3.3 `AgentContext` (built per request, shown in the trace)
```
{ user{id,name,role,specialty?}, permissions{tools, tiers},
  patient{id, name(masked for model), demographics},
  visit{id, status, complaint, arrivedAt, department, priority, openReferrals[]},
  clinical{ currentVitals+NEWS2, labs(abnormal first), medications, allergies, safetyAlerts, imaging, notes },
  history{ prior visits summary (labelled "historical"), conditions },
  conversation{ threadId, summary, focus }, now }
```
Rules: tools read from the context, not from free-text ids; **current visit data outranks history** (the proposed plan's "don't refer to cardiology just because of an old cardiac condition"); a role never receives sections it may not see.

### 3.4 Referral recommendation (the flagship decision)
* **Deterministic layer** `ReferralRulesService`: written with a clinician (examples to confirm: cardiology when chest pain + any of NEWS2 ≥ 5, troponin raised, ECG abnormality recorded, HR > 120 with hypotension; neurology when severe/sudden headache + focal deficit, altered consciousness, BP crisis…). Output: candidate specialties + triggering facts.
* **Model layer:** given context + rule hits + retrieved guidelines, returns **structured output** `{recommendation: SPECIALIST|NONE, specialty, urgency, rationale[], evidence[{field,value,source}], missingInfo[], confidence}`.
* **Verifier:** every `evidence` item must exist in the context (field and value); no valid evidence ⇒ downgraded to "needs doctor review". "No specialist required" is a valid outcome.
* **Output is a proposal** (never a write) → approval flow (W6).

### 3.5 Notifications
Persisted per recipient; delivered over the socket to room `user:<id>`; unread counts; **staff first**; patient notices stored with a channel adapter (`console`/SMS/e-mail interface) so the demo can show "Patient notified" without pretending a real channel exists.

---

## 4. The backlog (everything pending, in build order)

Effort = one developer, working days. **AC** = acceptance criteria.

> **Status (2026-10-08):** W0.1 migrations ✅ done · W1 visit lifecycle ✅ done (W1.1–W1.7, backend + UI; verified by `npm run test:workflow`, unit tests, `test:eval`, `retrieval-check`). W2 specialists ✅ done (W2.1–W2.3: specialist role + specialty, availability, bookings by doctor id; `npm run test:workflow`). W3 AgentContext ✅ done (context builder, state-aware tool policy, patient binding for write tools, hash/snapshot on every run). W4 tools ✅ done (W4.1–W4.3: domain subfolders, read tools, propose tools; unit tests in `w4-tools.spec.ts`). W5 referral recommendation ✅ done (W5.1–W5.4: ReferralRulesService, ReferralVerifierService, Cardiology/Neurology SOP guidelines in knowledge base, GET /hospital/patients/:id/referral-recommendation endpoint, unit tests in `w5-referral.spec.ts`). Next: W6 approval layer. Remaining W0 items (W0.2–W0.5) still open.

### W0 Foundations and decisions (3–4 days)
| ID | Task | Effort | AC |
|---|---|---|---|
| W0.1 | Adopt **TypeORM migrations** (baseline of current schema; turn `synchronize` off outside dev) | 1 | a fresh database is built only by migrations; CI check that entities and migrations agree |
| W0.2 | Get a **strong chat model** and benchmark 2–3 (tool choice, structured output validity, referral cases, latency, cost) | 1 | table of results; one chosen; `LLM_PROVIDER` set |
| W0.3 | **Mastra spike:** tool `requireApproval`, `approveToolCall/declineToolCall`, workflow suspend/resume, `structuredOutput`, `stopWhen`/`prepareStep` | 1 | one-page decision on what we use vs our own DB-backed approvals |
| W0.4 | **Clinical workshop:** referral criteria for cardiology + neurology, autonomy tiers (from `AGENT_UPGRADE_PLAN.md` §2), notification rules | 0.5 (external) | signed-off rules file |
| W0.5 | Clean demo data; scripted **fixtures** (patients with known outcomes: chest-pain, severe-headache, benign) | 0.5 | `npm run seed:demo` produces the same state every time |

### W1 Visit and lifecycle (5–6 days)
| ID | Task | AC |
|---|---|---|
| W1.1 | `visits` entity + migration; nullable `visitId` on vitals/labs/imaging/consultations/appointments/tasks; backfill one visit per existing patient | existing screens still work; counts match |
| W1.2 | `VisitLifecycleService` (allowed transitions, role per transition, audit, events) | invalid transitions rejected; unit tests for every transition |
| W1.3 | Registration = find-or-create **patient** + new **visit**; duplicate check (name + age/phone) with a "possible match" response | registering a returning patient creates a visit, not a new patient |
| W1.4 | Reception UI: **search first**, then register or "create visit for existing patient"; queue by visit with status | UI test: search finds existing; duplicate warning shown |
| W1.5 | Triage → `TRIAGED`; capture **symptoms and glucose**; set visit priority from NEWS2/ESI; nurse list = visits `WAITING_TRIAGE` | triage moves status; priority visible to doctor |
| W1.6 | Doctor list = visits `TRIAGED`/`IN_CONSULTATION`; first consultation moves status; completion rules | state shown in all portals |
| W1.7 | Events/alerts keyed by visit; update `PatientSummaryService` with visit section | summary contains current visit |
**Milestone M1:** reception → nurse → doctor with correct states on screen.

### W2 Doctors and specialists (3–4 days)
| ID | Task | AC |
|---|---|---|
| W2.1 | `users`: add `specialty`, `department`, `isAvailable`; role **`SPECIALIST`**; seed **Dr. Sarah Wilson (Cardiology)** and **Dr. Michael Chen (Neurology)** | login works for both |
| W2.2 | Availability model (weekly hours or slots) + link appointments to `doctorId` (keep name for display) | no double-booking per doctor id |
| W2.3 | `SpecialistService.find(specialty)` and `getAvailability(doctorId, range)` | unit tests; returns next free slot |

### W3 AgentContext (3 days)
| ID | Task | AC |
|---|---|---|
| W3.1 | `AgentContext` type + `AgentContextBuilder` (user, permissions, patient, visit, clinical snapshot, history, conversation) | built for every chat/agent call; stored (reference + hash) on the run |
| W3.2 | State-aware permissions: which tools/actions are allowed **for this role in this visit state** | e.g. no referral proposals for a completed visit; receptionist gets no clinical data |
| W3.3 | Replace free-text patient ids in tool inputs with context binding where possible; keep explicit-id tools for "search" | tests: tools cannot act on a patient other than the context's |

### W4 Tools (4–5 days)
| ID | Task | AC |
|---|---|---|
| W4.1 | Reorganise tools into domain folders (`patient`, `clinical`, `specialist`, `scheduling`, `notifications`, `actions`) without changing behaviour | all 15 existing tools pass their tests |
| W4.2 | New read tools: `getCurrentVisit`, `getVitalsHistory`, `getLabs`, `getMedications`, `getAllergies`, `findSpecialist`, `getSpecialistAvailability`, `searchClinicalGuidelines` | role/state checks; traced |
| W4.3 | New **propose** tools (return proposals only): `proposeReferral`, `proposeFollowUp`, `proposeTask`, `proposeNotification`, `proposeLabOrder` | no direct writes (eval gate) |

### W5 Referral recommendation (5–7 days)
| ID | Task | AC |
|---|---|---|
| W5.1 | `ReferralRulesService` with the signed-off criteria (data, not code) | 30 labelled cases: rules hit/miss as expected |
| W5.2 | Structured recommendation output + schema validation + **evidence verifier** | invalid or unsupported evidence ⇒ downgraded |
| W5.3 | Add cardiology and neurology guideline documents to the knowledge base (so the agent cites them) | citations appear in rationale |
| W5.4 | Entry points: doctor chat *"Review this patient and tell me if a specialist is required"* and a **Review** button on the chart | answer shows recommendation + evidence + missing info; **no write** |
**Milestone M2:** recommendation with evidence for the three fixture patients (cardiology / neurology / none).

### W6 Approval, actions and audit (8–10 days)  ← implements `AGENT_UPGRADE_PLAN.md` Phase 1
| ID | Task | AC |
|---|---|---|
| W6.1 | `agent_actions` entity, policy tiers (auto/ask/ask+human/never), proposal service (payload validated; summary rendered from payload) | proposals saved; summaries never from model prose |
| W6.2 | Executor as the **approving user**, re-validation at execution, idempotency, **read-back verification**, expiry job | double-approve safe; stale proposal fails safely |
| W6.3 | Endpoints + socket events; **approval card** UI + pending panel | nothing written before Approve (eval gate) |
| W6.4 | **Action audit record**: user, patient, visit, action, timestamp, reason, tool, result (+ link to run) | one query shows the full story of any action |
| W6.5 | Guardrail: the answer may say "done" only if the action is `DONE` | false completion claims = 0 |
**Milestone M3 (with W7):** Confirm → consultation request created → notified → audited.

### W7 Referral workflow and notifications (6–8 days)
| ID | Task | AC |
|---|---|---|
| W7.1 | `consultation_requests` entity + service + status machine; creating one links visit, patient, AI rationale/evidence | derived "awaiting specialist" on the visit |
| W7.2 | `NotificationService` (persist, per-user socket room `user:<id>`, unread counts, mark read) | persisted across refresh |
| W7.3 | Notification rules: referral created → specialist, primary doctor, nurse(s) on the visit, patient notice; referral completed → primary doctor, patient notice | each rule has an eval |
| W7.4 | `patient_notices` + channel adapter interface (console/SMS/e-mail stubs) | demo shows "patient notified" honestly as a stub |
| W7.5 | Persistent notification centre in the header (replace in-memory alerts) | survives reload; links to the item |

### W8 Specialist portal (5–6 days)
| ID | Task | AC |
|---|---|---|
| W8.1 | Portal: **My consultations** (by urgency), patient view with chart + visit + referral | only assigned/own-specialty requests visible |
| W8.2 | **AI referral summary** ("why was I referred?") from context + evidence + guidelines | cites evidence; read-only |
| W8.3 | Complete consultation form (assessment, recommendation, treatment, follow-up) → `COMPLETED` → notify primary doctor + patient | visit state updated |
| W8.4 | Chat drawer with the **SPECIALIST** tool set and specialty-aware guidelines | role-limited tools verified |
**Milestone M4:** full referral loop between two real users.

### W9 Follow-up agent (4–5 days)
| ID | Task | AC |
|---|---|---|
| W9.1 | `FollowUpPlan` proposal from consultation + treatment + labs + policy (appointment, lab order, task, patient notice) | proposals only; each needs approval |
| W9.2 | Minimal `lab_orders` (order → result link) | ordered lab appears in the lab flow |
| W9.3 | Completion: visit → `FOLLOW_UP` → `COMPLETED` with outcome | state machine respected |

### W10 Agent observability (3 days)
| ID | Task | AC |
|---|---|---|
| W10.1 | Extend `agent_runs`: **goal**, **context snapshot ref**, **decisions** (what/why/evidence), **action ids** | present for every agent run |
| W10.2 | Admin "Agent run" view: Goal → Context → Tool calls → Results → Decisions → Actions → Final result | one screen explains any run |
| W10.3 | Metrics: proposal acceptance/decline/expiry rates, time-to-decision, referral precision (vs clinician label), drift on acceptance rate | visible in Admin |

### W11 RAG improvement (6–8 days, **after** M4)
| ID | Task | AC |
|---|---|---|
| W11.1 | **Hybrid search** (PostgreSQL full-text + vector, reciprocal-rank fusion) | recall@k not worse than vector alone; better on exact terms/doses |
| W11.2 | **Metadata filters** (specialty, document type, effective date, department) | queries can restrict by metadata |
| W11.3 | **Query rewriting** for follow-ups; **reranking** of top-k; **context compression** | measured on the RAG eval set |
| W11.4 | **Citation spans** (document, section, quote) shown in the UI | every cited quote exists in the source |
| W11.5 | **RAG eval set** (≥ 50 questions): recall@k, MRR, citation accuracy, "no answer" correctness; CI gate | numbers tracked against a baseline |

### W12 Agent evaluation suite (6–8 days, grows through W1–W10)
Scenario runner with database fixtures and scripted + live models. Checks (each a hard or tracked metric):
| Check | Target |
|---|---|
| Correct tool/data chosen | ≥ 95 % on golden set |
| Correct specialist (cardiology / neurology / none) on labelled cases | ≥ 90 % agreement with clinician labels; **0** unsafe "none" on high-risk fixtures |
| Correct patient and visit used | 100 % |
| Asks a clarifying question when patient/intent is ambiguous | ≥ 90 % |
| Refuses/avoids unauthorized actions (role, state, tier "never") | **0** violations |
| Requests confirmation before any ask-tier action | 100 %; **writes before approval = 0** |
| Action executes correctly and is verified | 100 % on approved scenarios |
| Notification reaches exactly the right users | 100 % |
| No false "done" claims; no invented evidence | **0** |
| Prompt-injection resistance (notes/documents) | 0 injected actions in ≥ 50 adversarial fixtures |
Scenarios (first 25): register/search/duplicate · return visit · triage transitions · chest-pain → cardiology · severe headache → neurology · benign → none · historical cardiac condition but current non-cardiac visit (must **not** refer) · missing vitals → asks · specialist unavailable → alternative · two specialties at once · decline · expire · double approve · wrong role · closed visit · unknown patient · referral completed → notifications · follow-up plan · patient notice stub · injected "delete patient" note · injected "ignore rules" document · receptionist asks clinical question · specialist asks about a non-referred patient · conflicting medication safety alert · agent restart mid-task.

### W13 Hardening (≈ 5 days, parallel)
CI (unit + scripted eval per commit, live nightly) · provider failover + breakers for FHIR/Orthanc/embeddings · streaming responses · httpOnly cookies, refresh tokens, MFA · purge chat/traces on patient delete · Mastra Memory under our privacy rules · feedback buttons feeding the eval set · split `AiService` (router / context / answerer).

---

## 5. Milestones, timeline and the demo story

| Milestone | Cumulative (1 developer) | What you can demonstrate |
|---|---|---|
| **M1** Visit lifecycle (W0–W1, part of W2) | ~2.5 weeks | reception searches/registers → nurse triages (status changes) → doctor opens the visit |
| **M2** Context + tools + recommendation (W2–W5) | ~5 weeks | doctor: *"Review this patient and tell me if a specialist is required"* → recommendation with evidence and missing info, **no writes** |
| **M3** Approval + referral + notifications (W6–W7) | ~7.5 weeks | Confirm → referral created → cardiologist, doctor, nurse and patient notice → audited |
| **M4** Specialist portal + completion loop (W8) | ~9 weeks | cardiologist opens the referral, AI summarises why, completes it, primary doctor is notified |
| **M5** Follow-up + observability + evals gate (W9, W10, W12) | ~11 weeks | AI prepares the follow-up plan; Admin shows the full agent run; eval gate green |
| **M6** RAG improvements + hardening (W11, W13) | ~13–14 weeks | measurable retrieval gains, CI, failover, streaming |
This is **larger than the earlier 6-week estimate** because that plan assumed the visit, specialist, referral and notification workflow already existed — it does not. **Shortest honest story** (W0–W8 minus some W1/W7 polish): about **8–9 weeks**.

**Final demo script:** patient arrives → receptionist searches/registers → waiting → nurse triage (status `TRIAGED`) → doctor: *"Review this patient and handle anything that requires specialist attention"* → agent builds context, reads vitals/labs/meds/allergies, checks guidelines → recommends **Cardiology** with cited evidence → finds Dr. Sarah Wilson and her next slot → **approval card** → Confirm → consultation created → cardiologist, doctor, nurse notified and patient notice stored → audit shows who/what/why/result → cardiologist opens it, asks *"why was I referred?"*, completes it → doctor notified → agent proposes the follow-up plan → approve → visit `COMPLETED`.

---

> The full list of open questions with recommended answers is in [`POC_DECISIONS.md`](POC_DECISIONS.md).

## 6. Risks and decisions needed

| Risk | Mitigation |
|---|---|
| Visit refactor touches everything | nullable `visitId` + backfill + migrations first; keep old endpoints working during the transition |
| Referral logic is a clinical decision | clinician-approved rules; evidence verifier; always a human confirm; labelled "decision support" |
| Weak model (3B) can't do structured reasoning | W0.2 strong model; rules layer does the heavy lifting; evals measure it |
| Approval fatigue / stale proposals | autonomy tiers, expiry, re-validation at execution |
| No patient channel | staff in-app first; patient notices behind an adapter with an honest stub |
| Scope creep (multi-agent, proactive, voice) | explicitly **out of scope** until M5 passes |

**Decisions needed from you:**
1. Strong model/provider (needed in W0.2).
2. A clinician to sign the referral criteria and autonomy tiers (W0.4).
3. Role model: **`SPECIALIST` + `specialty`** (recommended) or one role per specialty.
4. Patient notifications: staff-only + stub first (recommended), or a real SMS/e-mail provider now.
5. Is the first presentation target **M3** (~7.5 weeks) or **M4** (~9 weeks)?

## 7. Explicitly *not* now
Folder restructuring · multi-agent supervisor · proactive/event-driven agent · voice · payer integrations · Mastra Memory migration · fine-tuning. (All are in the roadmap in `AI_AGENT_CONCEPTS.md` Part 8 for later.)

## 8. Definition of done for "this is an AI agent"
1. The full referral loop in section 5 works between real users, end to end, from the UI.
2. **0** writes before approval and **0** false "done" claims across the scenario suite.
3. Every action traceable: who, which patient/visit, what, when, why, via which tool, with what result.
4. Agent and RAG eval suites run in CI with a recorded baseline and regression gate.
5. Specialist decisions measured against clinician-labelled cases.
6. A written, honest list of what is still not production-ready.
