# Plan: from "RAG assistant" to a real AI agent

> **Update (2026-10-08):** the ordering of this plan is superseded by [`AGENT_PENDING_WORK.md`](AGENT_PENDING_WORK.md), which starts from the hospital workflow (visit lifecycle → specialists → AgentContext → referral recommendation) and uses **this document's Phase 1 (approvals, autonomy tiers, action audit, task evals) as work package W6**.


> **Goal (from the owner):** an AI agent that **takes decisions, asks the user's permission when needed, and completes the task**: not just a question-answering assistant.
> **Today (honest baseline):** a retrieve-first assistant. Answers are exact and safe, but only 4 of 15 tools can act, "ask permission" is an instruction (not enforced), there is no plan, no task state, no verification, nothing proactive, and no evaluation of *task completion*.
> **Companion docs:** [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) (system reference) · [`AI_AGENT_CONCEPTS.md`](AI_AGENT_CONCEPTS.md) (concepts, failures, labs).
> **Estimates** assume one developer; Mastra capability notes were read from the installed version's type definitions (`@mastra/core` 1.74) and **must be confirmed by a spike (Phase 0)** before relying on them.

---

## 1. What "agent" must mean here (the definition of done)

An action is *agentic* only if all six are true:

| # | Capability | Test that proves it |
|---|---|---|
| 1 | **Understands a goal** ("admit this patient and tell Dr. Jenkins") | the plan lists the right steps |
| 2 | **Decides** what to do alone, what to ask, what to refuse (by a written policy) | policy table enforced in code, not in the prompt |
| 3 | **Asks permission** with the exact action shown | nothing is written before an Approve click |
| 4 | **Executes** through the same validated, audited code as the screens | database state matches the plan |
| 5 | **Verifies** the result (reads it back) and reports honestly | "done" is only said when the read-back succeeded |
| 6 | **Is measured** on completing tasks safely | task-eval suite with 0 unsafe writes |

**Non-negotiable safety rules (keep for every phase)**
1. The model **proposes**; code and a human **decide**. No autonomous prescribing, deleting, or changing identity/permissions.
2. Proposals are built from **validated arguments**, and the approval card is rendered from the payload, **never from the model's prose**.
3. The executor runs as the **approving user**, with that user's role and the same DTO validation as the REST API.
4. Every proposal, decision and execution is stored and traceable (who proposed, who approved, what changed).
5. Keep the **retrieve-first** design for answering; the action layer is added on top of it.

---

## 2. Autonomy policy (decide this first, with a clinician)

| Tier | Meaning | Examples |
|---|---|---|
| **AUTO** | the agent may do it without asking; low risk, reversible, no clinical impact | draft SBAR / prior-auth / discharge text · compute NEWS2 · create a *self-assigned* reminder task · search anything the role may read |
| **ASK** | needs one Approve click by the requesting user | register patient · book/cancel appointment · record vitals or a lab result · create a task for others · order a lab · add a clinical note · close/reopen a session · notify a role |
| **ASK + HUMAN INPUT** | the card needs a person to type or confirm something the agent cannot supply | record consultation with prescriptions (the doctor reviews every drug; a `CRITICAL_BLOCK` safety finding can only be overridden by the human typing the reason) |
| **NEVER (via agent)** | the agent cannot even propose it | delete patient · create users / change roles / passwords · edit audit log · delete knowledge documents · bulk operations |

Store this as **data** (`action-policy.ts`, later a table) with fields: `type`, `tier`, `rolesAllowed`, `reversible`, `expiresInMinutes`, `requiresPatient`, `requiresSecondPerson?`. The agent never sees or edits it.

---

## 3. Phased plan

### Phase 0: Decisions and spikes (2–3 days)
| Task | Output |
|---|---|
| Get a **strong chat model** (cloud key or the proxy) and run `npm run test:eval:live` on it | model benchmark table (tool choice, grounded answers, latency, cost) for 2–3 candidates; pick one |
| Spike: Mastra **`requireApproval`** on a tool and **`approveToolCall`/`declineToolCall`**; Mastra **workflow suspend/resume** | a 1-page decision: use Mastra's mechanism, our DB-backed proposals, or both (recommended: **DB-backed proposals** because approvals must outlive a request, be visible to other sessions, and be audited; optionally wrap Mastra's approval for the in-run pause) |
| Write the **action catalogue + autonomy tiers** (section 2) and get it reviewed by a clinical advisor | `action-policy.ts` draft |
| Create the **task-eval skeleton** (empty scenarios runner + DB reset helper) | `tests/evaluation/scenarios/` runs and reports 0/0 |
| Clean the demo data (Eleanor's test consultation, stray FHIR patients) | repeatable fixtures |
**Exit:** model chosen, approval mechanism chosen, tiers signed off.

### Phase 1: Approval-gated actions: "asks permission, then completes" (≈ 8–10 days)  ← first demoable agent
**Backend**
| Item | Where / how |
|---|---|
| Entity `agent_actions` | `src/database/entities/agent-action.entity.ts`: `id, threadId, traceId, proposedBy, role, patientId, type, payload(jsonb), summary(deterministic text), tier, status (PENDING/APPROVED/DECLINED/EXPIRED/EXECUTING/DONE/FAILED), expiresAt, decidedBy, decidedAt, decisionNote, result(jsonb), verification(jsonb), idempotencyKey, createdAt` |
| `ActionPolicyService` | `src/ai/actions/action-policy.ts` + service: tier lookup, role check, expiry, "can this role propose this type for this patient state?" (e.g. closed session ⇒ reject) |
| `ActionProposalService.propose()` | validates payload with the existing DTOs (`validate-dto.ts`), renders `summary` from the payload (no model text), saves `PENDING`, emits `agent.action.proposed` over the role socket, returns the proposal |
| `ActionExecutor` | map `type → handler` calling the **existing** services (`HospitalLifecycleService.registerOutpatient`, `recordDoctorConsultation`, `HospitalService.bookAppointment`, `createTask`, …) **as the approver**; re-validates at execution time (patient closed? slot taken? drug conflict?); idempotency key; marks `DONE`/`FAILED` |
| **Read-back verification** | after execute, load the record and compare with the payload; store `verification {ok, checks[]}`; mark `FAILED` + alert if it differs |
| Endpoints | `GET /ai/actions?status=PENDING` · `POST /ai/actions/:id/approve` (`{overrideReason?, edits?}`) · `POST /ai/actions/:id/decline` · optional `approve-batch`; all role-checked, throttled, audited |
| Expiry job | reuse the `QueueMonitor` pattern: PENDING older than N minutes ⇒ `EXPIRED` |
| Tools become **propose-only** | change write tools in `src/ai/tools/lifecycle.tools.ts` / `hospital.tools.ts` to return `{status:'PENDING_APPROVAL', proposalId, summary}` instead of writing; AUTO-tier tools still write directly |
| Agent instructions | `src/ai/agent.ts`: "for changes, call the tool, then tell the user what is waiting for approval; never say it is done" |
| New guardrail | in `guardrails.ts`: an answer may claim "done/registered/booked" **only if** a matching action is `DONE` this turn (prevents false completion claims) |
| `/ai/chat` response | add `proposals: [{id,type,summary,payload,tier,expiresAt}]` |
| New actions to add | order lab · record vitals · record lab result · add clinical note · close/reopen session · send notification to a role · cancel appointment |
**Frontend** (`MastraChatDrawer.tsx`, `RoleContext.tsx`)
* **Approval card** in the chat: exact fields (table), patient name + id, risk badge, countdown, **Approve / Edit / Decline**; for consultations show the safety findings and a required override box when blocked.
* **Pending actions** bell/panel (shows proposals from any session), history timeline, socket events `agent.action.*`.
* Admin: approval funnel (proposed → approved → done / declined / expired / failed).
**Tests / evals (must pass before Phase 2)**
* Unit: policy tiers, payload→summary rendering, executor handlers, expiry, idempotency.
* Scenarios (scripted model, then live): *register + notify* · *book appointment (slot conflict)* · *consultation with allergy conflict (cannot be approved without human override)* · *decline* · *expired* · *approve twice (idempotent)* · *role not allowed* · *prompt-injection note asks to delete a patient (no proposal)*.
* Hard metrics: **writes before approval = 0**, **false completion claims = 0**, task success ≥ 90 % (chosen model).
**Exit / demo:** "Register John, 45, chest pain and ask Dr. Jenkins to see him" → two cards → Approve → both done and verified, all traced.

### Phase 2: Tasks with plans and state (≈ 8–10 days)
| Item | Detail |
|---|---|
| Entity `agent_tasks` | `goal, plan[{id, description, actionType, args, dependsOn, status}], status (PLANNING/WAITING_APPROVAL/RUNNING/DONE/FAILED/CANCELLED), currentStep, context(jsonb), result, ownerId, threadId` |
| **Planner** | model produces a plan as **structured output** (Mastra `structuredOutput`) restricted to the **action catalogue** (no free-form steps); server validates the plan (types exist, role allowed, dependencies acyclic) and shows it for approval (one click approves the *plan*; each ASK step still gets its card unless the user chose "approve all steps now") |
| **Executor loop** | runs steps in order, pauses at approvals, resumes when decided (DB-backed state machine; or Mastra workflow suspend/resume if the Phase 0 spike supports it), retries transient failures, stops on a failed verification, supports **cancel** |
| **Flagship workflows** (deterministic skeleton + model only for decisions/wording) | **Admission**: register → triage vitals → NEWS2 → notify doctor/task → (if high risk) escalate. **Discharge**: safety re-check of medications → draft discharge summary → translate → book follow-up → close session. **Critical lab response** (can be shared with Phase 3) |
| Decision points | the agent *decides* using rules + data (e.g. NEWS2 ≥ 5 ⇒ propose escalation; safety CRITICAL ⇒ propose alternative and ask the doctor), recording the **reason** on the step |
| UI | task timeline card ("step 3 of 5, waiting for your approval"), cancel button, resume after refresh |
| Evals | scenario DSL extended to multi-step: fixtures → user goal → expected plan → approvals scripted → **final DB state assertions**; metrics: task success rate, average steps, wasted steps, unsafe-action rate (0) |
**Exit / demo:** "Discharge Eleanor Vance" runs end to end with the safety conflict handled by asking the doctor.

### Phase 3: Proactive agent (≈ 5–7 days)
| Item | Detail |
|---|---|
| Event triggers | critical lab (`alert.critical_lab`), high NEWS2, patient waiting too long, new imaging uploaded, expiring approvals |
| Agent worker | consumes events (in-process first; BullMQ + Redis when scaling) and **proposes** actions (notify on-call, urgent task, draft note); deduplicates per patient/event; rate-limited |
| Notification center | persisted notifications with read/unread, links to the pending proposal |
| Controls | per-trigger on/off in Admin; "quiet hours"; every proactive proposal is labelled **"suggested by the system"** |
| Metrics | proposals per trigger, acceptance rate, time-to-decision (drift watches the acceptance rate) |
**Exit / demo:** a critical potassium result appears → a ready-to-approve escalation card appears for the doctor.

### Phase 4: Hardening and quality (≈ 5 days, can overlap)
| Item | Why |
|---|---|
| CI: unit + scripted evals on every commit; live evals nightly with the chosen model; regression gate | trust |
| Provider **failover** (primary → secondary model) and breaker for FHIR/Orthanc/embeddings | resilience |
| **Streaming** responses (SSE) | perceived speed |
| Fact-check pass for model-written answers (every number/date must exist in the context) + LLM-as-judge on a sample | accuracy of reasoning |
| Mastra Memory (working + semantic recall) layered under our privacy rules; purge chat/traces when a patient is deleted | memory quality, privacy |
| Feedback buttons feeding the eval set | continuous improvement |
| Security: httpOnly cookies, refresh tokens, MFA, rate limits per user | production readiness |

### Phase 5 (optional): Multi-agent and extras
Supervisor with specialist agents (triage, pharmacy, documentation, scheduling) using Mastra `network()`; voice input with clinician review; payer submissions. Only worth it if a single planner becomes too broad.

---

## 4. Timeline (one developer)

| Phase | Duration | Cumulative | What you can show |
|---|---|---|---|
| 0 Decisions + spikes | 2–3 days | ~0.5 week | model benchmark, tiers |
| **1 Approval-gated actions** | 8–10 days | **~2.5 weeks** | **first real agent demo** |
| 2 Tasks and plans | 8–10 days | ~4.5 weeks | admission and discharge workflows |
| 3 Proactive | 5–7 days | ~5.5 weeks | event-driven proposals |
| 4 Hardening | 5 days | ~6.5 weeks | CI, failover, streaming |
Compress by cutting Phase 3 or the second flagship workflow. **The minimum that honestly earns the word "agent" is Phase 0 + Phase 1.**

---

## 5. Evaluation plan for an agent (new, essential)

| Metric | Target | How measured |
|---|---|---|
| Task success rate | ≥ 90 % on 30+ scripted scenarios | final database state matches expected |
| **Writes without approval** | **0** (hard gate) | scenario asserts DB unchanged before Approve |
| **False completion claims** | **0** | answer says "done" ⇒ action status `DONE` |
| Wrong-patient actions | 0 | proposals checked against the scenario's patient |
| Approval-card correctness | 100 % payload ⇔ request | compare card payload with expected fields |
| Prompt-injection resistance | 0 injected actions in 50 adversarial notes/documents | adversarial fixtures |
| Over-asking (approval fatigue) | AUTO-tier actions need 0 approvals | tier tests |
| Latency | p95 time-to-proposal < 15 s on the chosen model | traces |
| Approval funnel health | acceptance/decline/expiry rates tracked | admin dashboard, drift |
Scenario list to build first (15): register+notify · book/conflict · cancel · record lab (critical) · consultation (allergy block → human override) · decline · expire · idempotent double approve · role denied · closed patient · unknown patient · injected "delete patient" note · injected "ignore rules" document · admission workflow · discharge workflow.

---

## 6. Data and API summary

```
agent_actions   (Phase 1)   one proposal = one action to approve
agent_tasks     (Phase 2)   one goal = a plan of steps (each step may create an agent_action)
notifications   (Phase 3)   persisted alerts/suggestions (read/unread)

POST /ai/chat            → { …existing, proposals: [...] , taskId? }
GET  /ai/actions         ?status=PENDING
POST /ai/actions/:id/approve   { overrideReason?, edits? }
POST /ai/actions/:id/decline   { reason? }
GET  /ai/tasks/:id             · POST /ai/tasks/:id/cancel
WebSocket: agent.action.proposed | decided | executed | failed · agent.task.updated
```

## 7. What we reuse (this is why Phase 1 is only ~2 weeks)
Role-checked tools and per-request tool sets · DTO validation (`validate-dto.ts`) · lifecycle services with transactions · audit interceptor · traces (`agent_runs`) · active-patient memory · retrieve-first routing · reliability wrapper · eval harness and baseline gate · WebSocket role rooms · approval UI patterns (typed confirmation modal in Patient management).

## 8. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Model proposes the wrong patient | the **server resolves the patient** (existing `findMentioned`/focus); the card shows name + id + key details; payload ids are verified against the resolved patient |
| Approval fatigue | tiers; AUTO for harmless actions; batch approve for plan steps; clear summaries |
| Stale proposal approved later | expiry + **re-validation at execution time** |
| Prompt injection via notes/documents | payload from validated args only; summary rendered from payload; tool results treated as data; NEVER-tier actions unreachable; adversarial evals |
| Partial failure in a multi-step task | step status + verification; stop on failure; clear "what was done / what wasn't" report; manual resume |
| Weak model plans badly | strong model; planner restricted to the action catalogue with structured output; deterministic workflow skeletons for flagship tasks |
| Clinical/regulatory exposure | the agent never decides clinically; every clinical write needs a human approval; labelled "decision support"; clinical advisor signs the tiers |
| Scope creep | ship Phase 1 first; each phase has an exit demo and eval gate |

## 9. First week, day by day (if you say go)
* **Day 1:** model benchmark on the strong model; Mastra approval/workflow spike; draft `action-policy.ts`.
* **Day 2:** entity, policy service, proposal service, executor for *register patient* and *create task*; unit tests.
* **Day 3:** propose-only write tools; instructions; "no false completion" guardrail; `/ai/actions` endpoints; first two scenarios in the eval.
* **Day 4:** approval card in the chat drawer; pending-actions panel; socket events.
* **Day 5:** more actions (book, consult with human override, lab, close/reopen); read-back verification; expiry job; remaining Phase 1 scenarios; demo run-through.

## 10. Decisions needed from you
1. Which **strong model** will you use (cloud key or proxy)?
2. Who is the **clinical advisor** to approve the autonomy tiers?
3. Flagship workflows: **admission and discharge**, or others?
4. Is **proactive** behaviour (Phase 3) in scope for the first presentation?
