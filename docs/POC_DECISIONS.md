# Open questions and recommended answers: making this the best possible POC

> **Purpose:** every decision still open before the project can become a convincing, honest AI-agent POC, with **my recommended answer**, the reason, and a fallback.
> **How to use:** answer the 🔴 questions first (they block work). Replying *"accept all recommendations"* is a valid answer; I will then follow the *Recommended* column.
> **Related:** [`AGENT_PENDING_WORK.md`](AGENT_PENDING_WORK.md) (the backlog these answers unblock) · [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) (current system).
> Priority: 🔴 blocks work now · 🟠 needed within the first milestone · 🟢 can wait.

## The eight to answer first

| # | Question | Recommended |
|---|---|---|
| Q1 | When is the first presentation, and to whom? | Raj + peers; target **milestone M3 (~7.5 weeks)**, with M1/M2 as checkpoints |
| Q3 | Which strong chat model? | An Anthropic-compatible frontier model through the **existing proxy provider**; keep local models for embeddings and offline fallback |
| Q4 | Real or synthetic patient data? | **Synthetic only** for the POC |
| Q9 | Who signs the clinical rules? | A named clinician; if none, use published guidelines, cited and labelled "illustrative, not clinical advice" |
| Q10 | Which specialties? | **Cardiology and neurology**, plus a "no specialist required" path |
| Q15 | Role model for specialists? | One role **`SPECIALIST`** + a **`specialty`** attribute |
| Q18 | How are patients notified? | In-app **patient notice** record with a stub channel; no real SMS yet |
| Q41 | How many developers? | **Two** (backend/workflow and frontend/evals) if available; otherwise one with scope cuts (Q42) |

---

## A. Goal and success criteria
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q1 🔴 | First presentation date and audience? | Raj + peers; aim for **M3** (approval → referral → notifications → audit) | shows the full "decides, asks permission, completes" loop | If the date is < 4 weeks: show **M1** (visit lifecycle) + the existing assistant, and present M3 as a plan |
| Q2 🔴 | What is the minimum that counts as "an AI agent" for this POC? | The **referral loop** (review → recommend specialist → human confirms → consult created → notified → specialist completes → follow-up proposed) | it contains decisions, permission and task completion | cut the follow-up step first |
| Q43 🟠 | How do we make Raj's five areas visible, not just present? | One visible artifact each: **tools** = approval card; **memory** = follow-up "him/her" + thread list; **evals** = an **Eval scorecard page** in Admin (reads the latest results/baseline); **reliability** = a live "stop the model" demo; **observability** = the Agent Run timeline | judges see evidence, not claims | slides with screenshots |
| Q44 🟠 | What is explicitly *out* of scope? | multi-agent supervisor, proactive agent, voice, payer integrations, fine-tuning | keeps the demo achievable | revisit after M5 |

## B. Model, hosting and cost
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q3 🔴 | Which chat model? | Strong cloud/proxy model for planning, referral reasoning and structured output; benchmark 2–3 in W0.2 | the 3B local model cannot plan or reason reliably; our scaffolding protects facts, not judgement | local larger model **with a GPU** |
| Q5 🟠 | Embeddings: local or cloud? | Keep **local `nomic-embed-text`** | raw record text never leaves the machine; semantic quality is good (24/24 retrieval checks) | OpenAI embeddings only for synthetic data |
| Q6 🟠 | Where does the demo run? | One machine with docker compose (Postgres, **own** HAPI, **own** Orthanc) + the API/web; chat model in the cloud, so **no GPU needed** | simple and repeatable | a small cloud VM |
| Q45 🟠 | Budget for model calls? | Set a **monthly cap** and track tokens per run (already recorded); a POC demo costs a small amount | prevents surprises | local model only |
| Q7 🟠 | Give FHIR/Orthanc dedicated servers? | **Yes.** Add them back to `docker-compose.yml` on ports 8081/8043; delete the 50 `patient-bulk-*` stray FHIR patients; remove or fix `npm run seed:fhir` | right now our data is mixed into another project's servers | keep sharing but prefix all our ids and document it |

## C. Clinical scope and safety
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q9 🔴 | Who approves the referral criteria and autonomy tiers? | A **named clinician advisor**, one 30-minute review per specialty | referral is a clinical decision | cite public guidelines (e.g. chest-pain and headache red-flag criteria) and label the rules "illustrative" |
| Q10 🔴 | Which specialties and rules? | Cardiology + neurology; **5–6 rules each** + "none required" | enough to show routing without a large clinical build | cardiology only |
| Q46 🟠 | May the agent ever act without asking? | Only **AUTO** tier: drafts, calculations, self-assigned reminders. Everything else needs Approve; prescriptions need a human; delete/user-management are **never** agent actions | clear, defensible line | stricter: everything asks |
| Q47 🟠 | How is a clinical recommendation presented? | Always: **recommendation + cited evidence (values from this visit) + missing information + confidence + "decision support only"**; "no specialist required" is allowed; evidence that cannot be verified downgrades to "needs doctor review" | trust and safety | show evidence only |
| Q48 🟠 | How should it treat history vs the current problem? | **Current visit outranks history** (the evaluation includes "old cardiac history but non-cardiac visit → must not refer") | avoids reflex referrals | — |
| Q20 🟢 | Escalation if no one responds? | Out of scope for the POC; sort by urgency and show age of the request | keeps scope | simple reminder task after N minutes |

## D. Workflow and data model
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q11 🔴 | Introduce a **Visit**? | **Yes**: patient (person) + visits (episodes); returning patients get a new visit; duplicate check on name + DOB/phone with a "possible match — confirm" step | the agent needs a current episode; today re-registering creates a duplicate person | skip duplicates, just add visits |
| Q12 🟠 | Real date of birth? | **Yes**, add `dob` capture (today it is approximated as Jan 1 of year − age) | matching, age-based rules | keep age |
| Q13 🟠 | How many lifecycle states? | Compact visit states (`REGISTERED → WAITING_TRIAGE → TRIAGED → IN_CONSULTATION → UNDER_REVIEW → TREATMENT → FOLLOW_UP → COMPLETED`, plus `CANCELLED/LEFT_WITHOUT_SEEN`); specialist stages live on **referrals** | a visit can have several referrals | single linear state |
| Q14 🟠 | What does the nurse capture? | vitals, **symptoms (chips)**, glucose, pain, chief complaint; the **nurse** assigns the final urgency; the system only suggests | realistic and gives the agent real context | vitals only |
| Q49 🟠 | Lab ordering scope? | Minimal `lab_orders` (order → result link) so the follow-up plan can order a lab | otherwise follow-up cannot "complete" | follow-up creates a task only |
| Q50 🟢 | Appointment UI? | Add a small calendar/list for appointments and referrals | the API exists; UI is missing | skip |

## E. Roles, permissions, approvals
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q15 🔴 | Specialist roles | **`SPECIALIST` + `specialty`** | no new role per specialty | separate roles |
| Q16 🟠 | Who approves a referral? | The **requesting doctor**; prescriptions: only the doctor; delete patient: admin with typed confirmation | matches responsibility | two-person approval for deletes |
| Q51 🟠 | Can staff see data outside their care team? | Keep role-based views for the POC; add a **break-glass** reason prompt later | minimum necessary | role-only |
| Q52 🟢 | Patient access (portal)? | Not in the POC; show a **"patient notice preview"** panel in the demo | patients have no accounts | read-only link |

## F. Notifications
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q18 🔴 | Patient channel | `patient_notices` table + **channel adapter** (console/SMS/e-mail interface); demo shows the notice and a "delivery: stub" status | honest; replaceable by Twilio later | Twilio sandbox |
| Q19 🟠 | Staff notifications | **Persisted per user**, unread counts, delivered over a per-user socket room; persistent bell | today they vanish on refresh | role-level only |
| Q53 🟢 | E-mail/SMS to staff? | No | scope | — |

## G. Agent behaviour and UX
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q21 🟠 | What should it do when unsure? | Ask **one or two clarifying questions** (ambiguous patient/visit, missing key vitals); never guess a patient | accuracy and trust | refuse with explanation |
| Q24 🟢 | Streaming? | Add after M3; with a cloud model most answers are a few seconds | lower priority once the model is fast | skip |
| Q25 🟢 | Multi-agent? | **No** for the POC; call the modes "specialised agent roles orchestrated by code" | simpler, more reliable | revisit after M5 |
| Q26 🟠 | Memory | Keep our own; after M4 migrate to **Mastra Memory** (working memory + semantic recall) under our privacy rules | shows framework alignment without delaying the loop | keep ours |
| Q27 🟠 | How much Mastra to use? | Use Mastra for tool approval, structured output and (if the spike is good) workflows; keep **our DB** as the record of proposals/approvals | the POC goal includes learning Mastra; approvals must outlive a request | our own state machine |
| Q23 🟢 | Languages | English only; say so | scope | — |

## H. Privacy, security, compliance
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q4 🔴 | Real patient data? | **Synthetic only**; label the app "demo data" | removes most compliance obligations | masked + agreement + legal review |
| Q8 🟠 | Repo visibility? | **Make the repo private** until after the review, or move the "known security gaps" and plan documents out of the public repo | the public repo now shows gaps and the dev DB password | keep public, remove sensitive docs |
| Q36 🟠 | The visible default DB password? | Remove the default from `docker-compose.yml` (`${DB_PASSWORD:?set it}`) and **rotate** your real DB password | it is in a public repo | accept for local-only |
| Q35 🟠 | Login hardening before outside viewers | httpOnly cookie + refresh token (MFA optional); per-user rate limit | token in `sessionStorage` is the main web risk | keep for local demo |
| Q33 🟠 | Audit log integrity | DB triggers that forbid `UPDATE/DELETE` on `audit_logs` and `agent_actions`; optionally a hash chain | today "immutable" is not true; cheap to fix | document as a gap |
| Q34 🟠 | Retention | Purge chat/traces when a patient is deleted; keep traces 30 days in the POC | chat history contains patient data | document |
| Q54 🟢 | De-identification | Real NER-based masking before any real-data use | dictionary masking misses new names | synthetic data only |
| Q37 🟢 | Shared seed password | Fine for local; force change + unique passwords before any shared deployment | — | — |

## I. Demo data and environment
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q38 🔴 | Which patients exist for the demo? | A **fixture set of ~8 synthetic patients** with known outcomes: chest pain (→ cardiology), severe headache + deficit (→ neurology), benign, **old cardiac history but non-cardiac complaint (must not refer)**, drug-allergy conflict, missing vitals (agent asks), returning patient, specialist unavailable; one command resets everything | makes the demo and the evals repeatable | smaller set |
| Q55 🟠 | Clean the current messy data? | Yes: remove test consultations on Eleanor, your ad-hoc test patients, stray FHIR patients; keep a `seed:demo` script | demo and evals need a known state | back up then reset |
| Q39 🟠 | What if the demo breaks? | Pre-record a short video, keep screenshots, pre-warm models, rehearse twice; lookups work even if the model is down (show that on purpose) | protects the day | — |

## J. Engineering and process
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q28 🔴 | Database migrations? | **Yes, first** (W0.1) | adding visits, referrals, notifications to an auto-synced schema is risky | keep `synchronize` for a throw-away demo DB |
| Q29 🟠 | CI? | GitHub Actions: lint, unit tests, build on every PR; scripted eval with a `pgvector` service container; **live eval nightly** only if an API-key secret exists | regression gate becomes automatic | run manually before releases |
| Q30 🟠 | Branching | feature branches + pull requests; protect `main` after M1 | traceable history, safe collaboration | trunk with tags |
| Q56 🟠 | Delete the dead code? | **Yes — please delete** `src/mastra/`, `src/ai/mcp/`, `src/ai/workflows/`, `src/app.service.ts`, `src/ai/tools/dicom-fhir.tools.ts`, `test/app.e2e-spec.ts` (I cannot do bulk deletes here) | reduces confusion; the TODO ideas are documented | leave with headers |
| Q57 🟠 | Big refactors (move folders, split `AiService`) | **Not now**; split `AiService` in W13 | no capability gain, merge risk | — |
| Q58 🟠 | Fix `npm run seed:fhir` | Rewrite it to seed **both** Postgres and FHIR from the fixture set, or remove it | today it creates FHIR-only patients | remove |
| Q41 🔴 | Team size | **Two developers**: A = backend workflow (W1–W3, W6–W7, W9), B = frontend (reception/specialist/notifications/approval UI) + evals (W12) → M4 in ~5–6 weeks | parallel work, shared interfaces defined by the plan | one developer: ~9 weeks to M4 |
| Q42 🟠 | If time is short, what do we cut? | In order: W11 (RAG upgrades), W9 (follow-up agent), real patient notices, streaming, Mastra Memory migration | the referral loop is the core | — |

## K. Evaluation and quality
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q31 🟠 | Who owns the golden set? | You + the clinician advisor label ~30 referral cases; engineering adds scenario fixtures | clinical truth must come from a clinician | rule-derived labels, marked "unvalidated" |
| Q32 🟠 | Targets | tool/data choice ≥ 95 %; specialist agreement ≥ 90 % with **0 unsafe "none" on high-risk fixtures**; **0 writes before approval**; **0 false "done" claims**; **0 injected actions** in ≥ 50 adversarial fixtures; every action traceable | measurable definition of done | track without gating |
| Q59 🟠 | Show the numbers to Raj? | Admin **Eval scorecard** page with latest vs baseline, per category | evidence on screen | screenshot of the CLI output |

## L. Presentation
| # | Question | Recommended answer | Why | Fallback |
|---|---|---|---|---|
| Q40 🟠 | Honest framing | One slide "**What is real vs simulated**": real = database, rules, approvals, audit, evals; simulated = patient SMS, some clinical rules (illustrative), local-model limits; and "**not for clinical use**" | credibility beats overclaiming | — |
| Q60 🟠 | Demo length and shape | 10 minutes: (1) triage → (2) doctor asks the agent → (3) evidence + recommendation → (4) approval → (5) notifications → (6) specialist portal + AI summary → (7) follow-up plan → (8) Admin: run timeline + eval scorecard + "stop the model" resilience | tells the whole story and covers all five areas | cut 7 |

---

## If you reply "accept all recommendations"
I will start with **W0** (migrations, model benchmark, Mastra spike, fixture data and the rules template for the clinician), then **W1** (visit lifecycle), in this order, committing on a feature branch and keeping the eval baseline green. The first thing you will see is **M1**: reception searches/registers → nurse triage changes the status → doctor opens the visit.

**What I need from you personally (cannot be decided by code):** a model/provider and key (Q3), a clinician contact (Q9), the date (Q1), and permission to delete the dead files and rotate the DB password (Q36, Q56).
