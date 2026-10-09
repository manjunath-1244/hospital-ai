# MK Hospital Platform — Complete Project Guide

> **Audience:** the developer who built/owns this project (to understand it, explain it, present it, extend it) and anyone joining the team.
> **Scope:** every concept and file in the repository: what it is, why it exists, how it works internally, where it lives in the code,
> what can go wrong, how to explain it, how to improve it, and whether it is finished.
> **Companion:** [`AI_AGENT_CONCEPTS.md`](AI_AGENT_CONCEPTS.md) explains the AI agent in depth (concepts, real failures and fixes, labs, how to present it).
> **Truth rule:** everything below was checked against the code and the running system (see *How this guide was verified* at the end).
> If you change the system, update this file.

**Status legend:** ✅ Done (built and tested) · 🟡 Partial (works, but limited — see the notes) · ⬜ Not built · 🗑 Dead code (unused, can be deleted)

---

## Table of contents
1. [The project in one page](#1-the-project-in-one-page)
2. [Architecture and data](#2-architecture-and-data)
3. [Backend concepts](#3-backend-concepts)
4. [AI concepts (the agent)](#4-ai-concepts-the-agent)
5. [Frontend concepts](#5-frontend-concepts)
6. [Running and operating it](#6-running-and-operating-it)
7. [Security and privacy review](#7-security-and-privacy-review)
8. [Status: done / partial / not built](#8-status-done--partial--not-built)
9. [What can go wrong (ranked)](#9-what-can-go-wrong-ranked)
10. [Roadmap: how to improve it](#10-roadmap-how-to-improve-it)
11. [How to explain and present it](#11-how-to-explain-and-present-it)
12. [File-by-file reference](#12-file-by-file-reference)
13. [Glossary](#13-glossary)
14. [How this guide was verified](#14-how-this-guide-was-verified)

---

# 1. The project in one page

## 1.1 What it is
**MK** is a proof-of-concept **hospital operating system with an AI assistant**. Staff sign in with a role (receptionist, nurse,
doctor, radiologist, pharmacist, care coordinator, admin) and each role gets its own screen. Everything they enter is saved to a
database, mirrored to healthcare-standard servers (HL7 FHIR for records, DICOM/Orthanc for images), made searchable for an AI agent,
and pushed live to the other roles. A chat assistant, available on every screen, answers questions about the hospital's data and
policies and can draft documents.

## 1.2 Why it exists
| Problem in a real hospital | What this project demonstrates |
|---|---|
| Patient information is scattered across separate systems; staff re-type or hunt for it | One record per patient, role-specific views, live updates between roles |
| Patients wait unseen and nobody notices | Live waiting queue with wait times and a one-time alert after 30 minutes |
| A deteriorating patient is missed | Vitals are scored automatically (NEWS2, sepsis screen, urgency level) and escalate by alert |
| Prescribing errors (allergy, interaction, kidney function) | A deterministic safety check on every prescription; critical conflicts are blocked unless a reason is written |
| Hospitals must exchange data in standards (FHIR, DICOM) | Records and images are pushed to a FHIR server and a PACS |
| Staff need answers fast, but a chatbot that guesses is dangerous | An AI agent that answers from the real data, shows its sources, masks patient names before the model sees them, and is measured by automated evaluations |
| Management wants proof an AI agent is reliable | Memory, evals with regression tracking, retries/timeouts/circuit breaker, drift detection, tracing, an admin observability screen |

It also exists as the **learning POC requested by Raj (CEO)** covering five areas: tool calling, memory/context, evals,
reliability/drift, and observability/tracing (mapped in [section 11.4](#114-mapping-to-the-five-areas-raj-asked-for)).

## 1.3 Who uses it (roles)
Seeded accounts (password = `SEED_USER_PASSWORD` from `.env`):

| Username | Role | Their screen | What they can do | What they can see |
|---|---|---|---|---|
| `receptionist` | RECEPTIONIST | Front desk | Register patients, watch the waiting queue, notify doctor (creates a task) | Demographics and queue only — never allergies, labs, medications |
| `nurse` | NURSE | ED Triage + Ward board | Enter vitals (NEWS2, sepsis screen, urgency suggestion), see sickest patients first, draft SBAR handoff (AI) | Vitals, labs, chart |
| `doctor` | DOCTOR | EMR workbench | Open a chart, record consultation (diagnosis, prescriptions, notes), complete/reopen a visit, book appointments | Full chart |
| `cardiologist`, `neurologist` | SPECIALIST (+ `specialty`) | Specialist portal | Manage own availability, see own appointments. Referral inbox and patient access come with the referral work (W7/W8) — until then a specialist sees **no patient data** | Own profile and appointments |
| `radiologist` | RADIOLOGIST | Radiology | Upload DICOM scans with an impression, enter lab results, preview images | Imaging, labs |
| `pharmacist` | PHARMACIST | Pharmacy | See every new prescription with its safety result; check any drug list for any patient | Medications, allergies, labs |
| `coordinator` | CARE_COORDINATOR | Care coordination | Generate AI drafts: prior-authorization letter, discharge instructions translated | Conditions, medications, consultations |
| `admin` | ADMIN | Admin + "View as" any portal | Service health, audit log, agent metrics/drift/traces, upload hospital documents for the agent, close/delete patients | Everything |

### Role matrix (tested)
`tests/workflow/roles-matrix.mjs` checks **every role against every endpoint (415 combinations)** and the chart sections each role receives; `src/ai/tools/tool-roles.spec.ts` does the same for the agent's tools. They were written as the specification first; the failures they exposed were fixed: a specialist could list all patients and visits, the follow-up endpoints had no role check, and the agent's chart-read tools gave pharmacists, radiologists and coordinators vitals/allergies that the patient summary withholds. Rules worth remembering: a **specialist has no patient list or hospital-wide search**; they reach a patient only through a referral that is theirs (REST and agent tools alike); only the person who proposed an agent action (or an admin) can approve it; receptionists never receive allergies, medications, conditions, labs or vitals.

## 1.4 The patient journey (what happens to the data)
1. **Receptionist searches, then registers** — a returning patient gets a new *visit*; a new person gets a `patients` row **and** a first visit (`WAITING_TRIAGE`). If name/phone/DOB resemble an existing patient the API answers 409 with `possibleMatches` until the receptionist confirms. Copy to FHIR, search index entry, live events (`patient.registered`, `visit.updated`).
2. **Waiting too long** (>30 min, configurable) → the queue monitor raises *one* alert per visit.
3. **Nurse triage** → vitals (+ symptoms, glucose) saved on the visit; server computes NEWS2 + sepsis screen + suggested urgency; the visit becomes `TRIAGED` and gets a priority (ESI suggestion unless the nurse overrides); a high score alerts doctors and nurses.
4. **Doctor consultation** → safety check on prescriptions (allergies, duplicates, interactions, kidney function). Critical conflict ⇒ HTTP 409 unless the doctor gives an override reason. Saved in one transaction together with the move to `IN_CONSULTATION` (and the primary doctor).
5. **In parallel** — radiologist uploads scans (parsed → stored in Orthanc → FHIR ImagingStudy → searchable) and labs (classified normal/abnormal/critical → FHIR Observation → critical lab alert); pharmacist sees the prescription with its safety result.
6. **Afterwards** — coordinator drafts paperwork (clinician must review); a doctor/admin **completes the visit** (no new clinical writes until it is reopened with a reason) and the patient can come back later with a new visit; an admin can **delete** a patient permanently (database, search index, FHIR, unused images; audit log kept).
7. **At any time** — any role asks the chat assistant; every request is audited, every AI run is traced.

## 1.5 Technology stack (as installed)
| Layer | Technology |
|---|---|
| API | NestJS 11 (TypeScript), TypeORM 1.x, PostgreSQL 16 with **pgvector**, Socket.IO 4, JWT (`@nestjs/jwt`), bcryptjs, helmet, class-validator, `@nestjs/throttler` |
| AI | **Mastra** `@mastra/core` 1.74 (Agent, tools), Vercel AI SDK 6 (`ai`), providers: OpenAI, Google, Groq, Anthropic-via-proxy (`cli_proxy`), **Ollama** (local) |
| Local models | `llama3.2-hospital` (built from `llama3.2:3b`, 8k context, low temperature — see `ops/Modelfile.hospital`), `nomic-embed-text` (768-dim embeddings) |
| Standards | HAPI FHIR R4 server, Orthanc PACS (DICOM), `dicom-parser` |
| Web | Next.js 16 (App Router), React 19, Tailwind 4, `socket.io-client`, lucide icons, Inter + JetBrains Mono fonts |
| Docs | `pdf-parse` for PDF uploads |
| Tests | Jest (87 unit tests), custom evaluator (116 scripted checks, 136 with the live-model section), retrieval check (24) |

## 1.6 Ports and services
| Service | Address | Owned by this project? |
|---|---|---|
| Web app | http://localhost:3001 | yes |
| API | http://localhost:3000 | yes |
| PostgreSQL + pgvector | 127.0.0.1:**5433** (container `hospital_postgres`, volume `pgdata`) | yes (docker compose) |
| HAPI FHIR | http://localhost:8080/fhir | **No** — currently another project's container (`gym-hapi-fhir`); not in this repo's compose file any more |
| Orthanc PACS | http://localhost:8042 | **No** — currently another project's container (`gym-orthanc`) |
| Ollama | http://localhost:11434 | local install (models: `llama3.2-hospital`, `nomic-embed-text`) |

---

# 2. Architecture and data

## 2.1 Module map
```
                        ┌───────────────────────────── Browser (Next.js, :3001) ─────────────────────────────┐
                        │ Login · role portals · chat drawer · admin panels   (REST + JWT)  (Socket.IO + JWT) │
                        └───────────────┬───────────────────────────────────────────────┬───────────────────┘
                                        │                                               │
┌───────────────────────────────────────▼───────────────────────────────────────────────▼───────────────────┐
│ NestJS API (:3000)   global guards: Throttler → JwtAuthGuard(+@Roles) · interceptor: AuditInterceptor         │
│                                                                                                               │
│  AuthModule        login (bcrypt) → signed JWT                                                                │
│  HospitalModule    controller · HospitalLifecycleService (workflows) · News2 · MedicationSafety · lab-rules    │
│                    PatientSummaryService · QueueMonitor                                                       │
│  AiModule          AiController · AiService (the chat brain) · routing/ · tools/ · memory/ · reliability/      │
│                    observability/ · security/ (PHI) · llm/                                                    │
│  KnowledgeModule   EmbeddingProvider · VectorStore(pgvector) · VectorRagService · KnowledgeDocuments · backfill│
│  InteropModule     FhirHapiClient · FhirService(mapper) · DicomService · OrthancClient                         │
│  EventsModule      HospitalEventsGateway (authenticated, role-scoped WebSocket rooms)                         │
│  AdminModule       health · audit log · agent metrics/runs · knowledge documents · reindex                    │
│  DataModule        entities + HospitalService + ClinicalRecordsService + SeedService                          │
└───────┬──────────────────────────────┬───────────────────────────┬──────────────────────┬───────────────────┘
        │                              │                           │                      │
  PostgreSQL 16 (+pgvector)      HAPI FHIR (mirror)          Orthanc PACS (images)    LLM + embeddings
  SOURCE OF TRUTH                Patient/Observation/        DICOM instances          (Ollama local, or cloud)
  + vector index (derived)       ImagingStudy                                         sees MASKED text only
```
Module dependencies point **downward only** (no cycles): `DataModule` depends on nothing; `HospitalModule` and `AiModule` depend on Data/Knowledge/Interop/Events; `AdminModule` depends on those; `AiModule` depends on `HospitalModule`, never the reverse.

## 2.2 The golden rule
> **PostgreSQL is the single source of truth.** FHIR, the PACS pixel store and the vector index are *derived copies*. If they ever disagree with Postgres, Postgres is right and the copies are rebuilt (server start, or admin "Re-index everything").

## 2.3 Database tables (17)
| Table | Purpose | Key columns |
|---|---|---|
| `users` | Staff accounts | `username` (unique), `passwordHash` (bcrypt cost 12), `role`, `displayName`, `specialty`, `department`, `isAvailable` (leave switch) |
| `doctor_availability` | A doctor's weekly working hours | `doctorId`, `weekday` (0=Sunday), `startTime`/`endTime` (`HH:mm`, UTC), `slotMinutes` |
| `patients` | The person | `id` (`P`+6 chars, seeds `P1001–P1003`), demographics (`dob` + `dobApproximate`), `allergies`/`currentMedications`/`conditions` (jsonb arrays), `registeredAt`, `fhirSynced`. **No status** — that lives on the visit |
| `visits` | One episode of care (the workflow state) | `id` (`V`+7), `patientId`, `status` (9 values, see 3.10), `chiefComplaint`, `priority` (1–5), `primaryDoctorId/Name`, `arrivedAt/triagedAt/consultationStartedAt/completedAt`, `waitAlertedAt`, `outcome`, `closeReason`. Partial unique index: one open visit per patient |
| `visit_events` | Timeline of every status change | `visitId`, `fromStatus`, `toStatus`, `actorId/Name/Role`, `note`, `at` |
| `consultations` | One doctor visit | `patientId`, `doctorId/Name`, `diagnosis`, `prescriptions` (jsonb), `notes`, `safety` (jsonb report), `overrideReason` |
| `vitals` | One triage measurement | `visitId`, HR, systolic BP, SpO2, temp, RR, symptoms, glucose, consciousness, on-oxygen, `news2Score`, `riskLevel`, `recordedBy` |
| `lab_results` | One lab value | `testName`, `value`, `unit`, `referenceRange`, `status` (NORMAL/ABNORMAL/CRITICAL), `recordedBy` |
| `imaging_studies` | Scan **metadata** (pixels live in Orthanc) | `studyInstanceUid`, `modality`, `description`, `impression`, `orthancInstanceId`, `fhirId`, `uploadedBy` |
| `appointments` | Bookings | `doctorId` (real account, optional for legacy free-text bookings), `doctorName`; unique indexes on (`doctorId`,`dateTime`) and (`doctorName`,`dateTime`) where `SCHEDULED` — double-booking impossible at DB level |
| `staff_tasks` | To-dos for staff | `title`, `assignedTo`, `patientId`, `priority`, `status` |
| `audit_logs` | Who touched what | `userId`, `role`, `method`, `path`, `patientId`, `statusCode`, `at` |
| `knowledge_documents` | Admin-uploaded policies | `title`, `filename`, `content`, `ragSource`, `uploadedBy` |
| `chat_threads` / `chat_messages` | AI conversation memory | thread: `userId`, `title`, `summary`, `summarizedCount`, `activePatientId`; message: `role`, `content` |
| `agent_runs` | One trace per AI request | `model`, `status`, `durationMs`, `steps` (jsonb spans), `usage`, `toolNames`, `guardrailStatus`, `retries`, `error`, `contextHash` + `context` (PHI-free AgentContext snapshot) |
| `document_embeddings` | **Derived** vector index | `source`, `kind` (`policy`/`patient_record`), `patient_id`, `heading`, `content`, `content_hash`, `embedding vector(768)` + HNSW cosine index |

Schema creation: **TypeORM migrations** (`src/database/migrations`; `synchronize` is off; `DB_MIGRATIONS_RUN=false` skips auto-run). `Baseline` captures the original schema (skipped if tables exist); `VisitsAndLifecycle` adds visits/visit_events, links `visitId` onto vitals, labs, imaging, consultations, appointments and tasks, and backfills one visit per existing patient (old CLOSED → COMPLETED, SEEN → IN_CONSULTATION, WAITING → TRIAGED if vitals exist else WAITING_TRIAGE). The vector table `document_embeddings` is created by its service and excluded from sync. Entities and migrations must agree: run `npm run migration:generate` after any entity change.

## 2.4 Write path (anything a user enters)
```
Browser → REST → ThrottlerGuard → JwtAuthGuard (verify token, check @Roles) → ValidationPipe (whitelist, forbidNonWhitelisted)
        → HospitalLifecycleService.<workflow>
            1. Save to PostgreSQL (transaction where several tables change)        ← authoritative
            2. Best-effort side effects, each wrapped so failure never loses the record:
                 • FHIR upsert (PUT, idempotent)      • chunk + embed + upsert into pgvector      • WebSocket event to the right roles
            3. Response includes fhirSynced / ragIndexed so nothing is hidden
        → AuditInterceptor writes an audit row (user, role, method, path, patientId, status)
```
**Repair:** on every server start `FhirDicomIngestService` re-checks all patients against FHIR and the index (idempotent, unchanged chunks are skipped by content hash); admin can trigger the same with *Re-index everything*.

## 2.5 Read paths
* **Screens:** REST reads PostgreSQL; field sets are trimmed per role (`PatientSummaryService`, `viewFor()` in the controller).
* **AI chat:** see [section 4.1](#41-the-big-idea-retrieve-first-then-write).
* **Nothing reads clinical data back from FHIR** (except two admin-only agent tools that report what FHIR holds).

## 2.6 Real-time path
`HospitalEventsGateway` (Socket.IO). A client must present a valid JWT in the handshake (`auth.token`); invalid ⇒ disconnected. Each socket joins a room `role:<ROLE>`; events are emitted only to the roles that need them. Events: `patient.registered`, `doctor.consulted`, `alert.unconsulted_patient`, `alert.critical_lab`, `alert.news2_deterioration`, `dicom.uploaded`, `visit.updated`, `patient.deleted`. Payloads are deliberately minimal (no phone/DOB/allergies).

## 2.7 Delete path
`DELETE /hospital/patients/:id?confirm=<id>` (ADMIN): one transaction removes labs, vitals, consultations, imaging, appointments, tasks, clears chat-thread focus, deletes the patient → then best effort: vector chunks, FHIR (`?_cascade=delete`), Orthanc instances **only if no other study still uses the same stored image** (identical DICOM files share one instance — a bug here was found and fixed). Audit log rows remain.

## 2.8 Configuration (environment)
Validated at startup by `src/config/app.config.ts` (zod); the server refuses to start with a readable error if a required value is missing or `JWT_SECRET` < 32 chars.

| Variable | Meaning | Default / note |
|---|---|---|
| `PORT` | API port | 3000 |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | PostgreSQL | port **5433** in this dev setup |
| `JWT_SECRET` | token signing key | required, ≥ 32 chars; `JWT_EXPIRES_IN` default `8h` |
| `CORS_ORIGINS` | allowed browser origins | `http://localhost:3001` |
| `SEED_USER_PASSWORD` | password for the 7 seeded accounts | if unset a random one is generated and logged once; `SEED_DEMO_DATA=false` skips the 3 demo patients |
| `FHIR_SERVER_URL`, `ORTHANC_URL`, `ORTHANC_USERNAME/PASSWORD` | interop servers | 8080 / 8042 |
| `WAIT_ALERT_MINUTES` | waiting-room alert threshold | 30 |
| `LLM_PROVIDER` | `cli_proxy` (default if unset) · `anthropic` · `ollama` · `google` · `groq` · `openai` | currently `ollama` |
| `OPENAI_API_KEY`/`OPENAI_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`/`GEMINI_MODEL`, `GROQ_API_KEY`/`GROQ_MODEL` | cloud providers | keys currently empty |
| `CLI_PROXY_API_URL`, `CLI_PROXY_API_TOKEN`, `CLI_PROXY_MODEL` | Anthropic-compatible proxy provider (added by the team; strips `tool_choice` for compatibility) | token currently empty |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL` | local models | `llama3.2-hospital`, `nomic-embed-text` |
| `EMBEDDING_PROVIDER` | `openai` · `ollama` · `auto` (OpenAI if key present, else keyword-only fallback) | currently `ollama` |
| `AI_TIMEOUT_MS` (45 000), `AI_MAX_RETRIES` (2), `AI_RETRY_BASE_MS` (500), `AI_TOOL_TIMEOUT_MS` (10 000), `AI_BREAKER_THRESHOLD` (5), `AI_BREAKER_COOLDOWN_MS` (30 000), `AI_CONTEXT_TOKENS` (3000), `AI_WARMUP` (`false` disables) | AI tuning | defaults in brackets; `.env` sets `AI_TIMEOUT_MS=120000` for the slow local model |
| `NEXT_PUBLIC_API_URL` (web) | where the browser finds the API | `http://localhost:3000` |
| `EVAL_LIVE_LLM=1`, `DICOM_SAMPLE_PATH` | test-only | see section 4.15 |

---
# 3. Backend concepts

Every concept uses the same template: **What · Why · How it works · Where · What can go wrong · How to explain it · Improvements · Status**.

## 3.1 Startup and configuration
* **What:** `main.ts` boots Nest with security middleware; `app.config.ts` validates settings.
* **Why:** a half-configured medical system must fail loudly at start, not misbehave at 2 a.m.
* **How:** `import 'dotenv/config'` runs first (modules read env at import time, e.g. WebSocket CORS). Then `helmet()` (security headers), `enableCors` for `CORS_ORIGINS` only, a global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`: unknown fields ⇒ HTTP 400), shutdown hooks. `ConfigModule` runs a zod schema; `TypeOrmModule` uses `synchronize` unless `NODE_ENV=production`.
* **Where:** `src/main.ts`, `src/config/app.config.ts`, `src/app.module.ts`.
* **Can go wrong:** wrong `DB_PORT` ⇒ Nest retries then exits; a migration that fails halts start-up (fix it; restore the backup); env read at import means a missing `import 'dotenv/config'` silently changes CORS/provider.
* **Explain it:** "The server checks its own settings before it starts, and rejects any request body that has fields it doesn't know."
* **Improve:** CI check that entities and migrations agree; secrets from a vault; per-environment config files.
* **Status:** ✅ (✅ migrations).

## 3.2 Authentication and roles (RBAC)
* **What:** login with username + password → signed JWT; every route requires it unless marked `@Public()`; `@Roles(...)` restricts further.
* **Why:** an earlier prototype trusted a header ("doctor") — anyone could pretend to be anyone. Medical data needs real identity.
* **How:** `AuthService.login` compares with bcrypt (a dummy hash is compared when the user doesn't exist, so response time doesn't reveal valid usernames). The token holds `sub`, `name`, `role`, expires in 8 h. `JwtAuthGuard` (global) verifies the signature, attaches `request.user`, then checks `@Roles`. Throttling: 120 requests/min per client globally, **10/min on login** (brute-force protection), **20/min on the AI endpoints** (cost control).
* **Where:** `src/auth/*`, `src/security/jwt-auth.guard.ts`, `roles.decorator.ts`, `auth-user.ts`; users seeded by `src/database/seed.service.ts`.
* **Can go wrong:** token stolen from the browser (it is in `sessionStorage` — readable by any script on the page); no refresh token, no server-side revocation, no logout-everywhere; the throttle counts per IP so many staff behind one hospital NAT share a login limit; if `JWT_SECRET` leaks all tokens are forgeable.
* **Explain it:** "You prove who you are once; every later request carries a signed badge, and each door checks the badge's role."
* **Improve:** httpOnly cookies, refresh tokens + revocation list, MFA, SSO (SAML/OIDC) with the hospital directory, per-user (not per-IP) throttling, password change/reset, account lockout.
* **Status:** ✅ core · 🟡 no refresh/revocation/MFA/user management screen.

## 3.3 Audit log
* **What:** a row for every authenticated request: who, role, method, path, patient id, status.
* **Why:** healthcare rules (HIPAA-style) require knowing who accessed which record.
* **How:** `AuditInterceptor` (global) records after the response; it never blocks or fails a request. Patient id comes from the URL or body. Read in the admin screen (`GET /admin/audit-logs`).
* **Where:** `src/security/audit.interceptor.ts`, entity `audit-log.entity.ts`, admin controller.
* **Can go wrong:** not tamper-proof (an admin with DB access can edit it); grows without limit; failed audit writes are only logged; it records *requests*, not the exact fields read.
* **Explain it:** "A CCTV log for patient data."
* **Improve:** append-only/WORM storage or hash-chained rows, retention + archiving, export, field-level read auditing, alerting on unusual access (e.g. one user opening many charts).
* **Status:** ✅ basic · 🟡 retention/tamper-evidence missing.

## 3.4 Patient registration and identifiers
* **What:** creates a patient with a generated id **and their first visit** (waiting for triage); for a returning patient, `POST /hospital/patients/:id/visits` opens a new visit instead.
* **Why:** the first step of the journey; the id must never collide or overwrite someone else.
* **How:** `newId('P',6)` draws 6 characters from a 32-symbol alphabet (no 0/O/1/I/L; unbiased random bytes). `createPatient` uses `INSERT` (not upsert) and retries on a unique-violation up to 5 times. Input rules (name length, gender, phone pattern, blood group, complaint ≤ 500) are class-validator decorators. Then FHIR push, index, event.
* **Where:** `src/hospital/hospital-lifecycle.service.ts` (`registerOutpatient`, `startVisit`), `patient-matching.ts`, `patient-identity.ts`, `hospital.service.ts` (`createPatient`), `dto/hospital.dto.ts`, `src/common/ids.ts`.
* **Can go wrong:** duplicate detection is advisory (the receptionist may confirm "different person"); matching is name/phone/real-DOB only (`patient-matching.ts`, approximate DOBs are never used); phone is not unique; when only an age is given the DOB is approximated as Jan 1 and flagged `dobApproximate`.
* **Explain it:** "Registering creates the chart and the waiting-room ticket, and every other system hears about it."
* **Improve:** master patient index / duplicate matching (name + DOB + phone), real date of birth field, national id, insurance data, photo/consent capture, print wristband/token (UI prints a browser page only).
* **Status:** ✅ · 🟡 duplicate check is name/phone/DOB only; no master patient index.

## 3.5 Consultation and the medication-safety shield
* **What:** the doctor records diagnosis, prescriptions and notes; prescriptions are screened first.
* **Why:** prescribing errors are a leading cause of harm; a deterministic check never "hallucinates".
* **How:** `MedicationSafetyService.audit()` normalises each drug ("Amoxicillin 500mg TID" → `amoxicillin`), then checks: **allergies** (direct match, class match for penicillins / sulfonamides / NSAIDs, and cephalosporin cross-reactivity as a warning), **duplicate therapy** (vs current medications and within the order), **interactions** (warfarin+NSAID/clopidogrel, ACE-inhibitor+potassium, simvastatin+macrolide, PDE5+nitrate, SSRI+tramadol, metformin+contrast), **kidney function** (eGFR from the latest creatinine by CKD-EPI 2021: metformin critical < 30 / warning < 45; NSAIDs critical < 30 / warning < 60; enoxaparin warning < 30). Result: `SAFE` / `WARNING` / `CRITICAL_BLOCK`. A critical block returns **HTTP 409 with the findings**; the doctor can resubmit with `overrideReason` (≥ 5 chars). The consultation and the patient chart update happen in one DB transaction. A doctor can only sign as themselves (admins may name a doctor).
* **Where:** `medication-safety.service.ts`, `hospital-lifecycle.service.ts` (`recordDoctorConsultation`, `screenMedications`), `clinical-records.service.ts` (`saveConsultation`), UI `DoctorWorkbenchPortal.tsx`.
* **Can go wrong:** the drug tables are small and hand-written (not a drug database); drug names are matched by text (misspellings, brand names, combination products are missed); doses are not checked at all; no pregnancy/age/weight rules; "no allergy recorded" is treated as "no allergy".
* **Explain it:** "A pharmacist-in-code reads every prescription before it is saved, and refuses dangerous ones unless the doctor explains why."
* **Improve:** integrate a licensed drug knowledge base (RxNorm/ATC + interaction DB such as First Databank/Medi-Span/DrugBank), dose-range and renal dosing, pregnancy/age/weight rules, allergy severity, brand→generic mapping, a prescribing-formulary, and a pharmacist **approve/reject** step (today the pharmacist only views).
* **Status:** ✅ working and tested (8 unit tests) · 🟡 coverage limited.

## 3.6 Triage: NEWS2, sepsis screen, urgency suggestion
* **What:** from vitals the server computes the NEWS2 deterioration score, a SIRS sepsis screen and a *suggested* ESI urgency level.
* **Why:** to catch deterioration early and consistently. It is a calculation, so it must not depend on an AI model.
* **How:** `News2Service.calculate` implements the Royal College of Physicians 2017 chart (respiratory rate, SpO2 scale 1 or 2, supplemental oxygen, systolic BP, pulse, consciousness, temperature). Risk: ≥ 7 HIGH, 5–6 MEDIUM, any single parameter scoring 3 ⇒ LOW_MEDIUM and escalate; aggregate ≥ 5 or any red ⇒ `escalate` ⇒ an alert event to doctors/nurses/admin. SIRS counts temp > 38 or < 36, HR > 90, RR > 20 (WBC/PaCO2 are *not* assessed, stated in the output). ESI: 1 for unresponsive / pain-only / SpO2 < 85 / SBP < 70; 2 for HIGH NEWS2 or altered consciousness; 3 for escalate or SIRS positive; 4–5 otherwise. Output always says "decision support only".
* **Where:** `news2.service.ts` (+ spec), lifecycle `recordTriageAndVitals`, UI `EdTriagePortal.tsx`; chat path: `ai/routing/vitals-parser.ts`.
* **Can go wrong:** the ESI rules are our simplification, not the official ESI algorithm (which also considers resources needed); no chronic-condition/COPD automatic scale selection (the nurse ticks Scale 2); no trend over time; wrong typing of vitals changes the score (inputs are range-validated).
* **Explain it:** "Enter the numbers, get the standard hospital early-warning score instantly — the same math every time."
* **Improve:** NEWS2 trend charts per patient, automatic escalation tasks (page the on-call doctor, re-check timers), official ESI decision tree, paediatric scores (PEWS), device integration for vitals.
* **Status:** ✅ NEWS2/SIRS · 🟡 ESI is a heuristic.

## 3.7 Lab results and critical values
* **What:** a lab value is saved, classified and (if critical) alerted.
* **Why:** a panic value must reach a clinician immediately.
* **How:** `assessLab` first applies **unit-aware critical limits** (glucose < 50 or > 250 mg/dL, potassium < 2.8 or > 6.0 mmol/L, sodium < 120 or > 160, HbA1c > 10 %, creatinine > 4.0 mg/dL, troponin > 0.4 ng/mL, lactate > 4, haemoglobin < 7 g/dL, platelets < 20) — only when the unit matches, so a value in the wrong unit is never mis-flagged; then compares with the reference range ("a - b") for ABNORMAL. Critical ⇒ `alert.critical_lab` to doctors, nurses, admin, pharmacists. Mirrored to FHIR as an Observation.
* **Where:** `lab-rules.ts` (+ spec), lifecycle `recordLabResult`, UI inside `RadiologyPortal.tsx` (lab form).
* **Can go wrong:** limited test list; free-text test names matched by keyword; no age/sex-specific ranges; no lab *ordering*, specimen tracking, or result acknowledgement; non-numeric results are treated as normal.
* **Explain it:** "Type a result; the system knows if it's normal, abnormal or a panic value and tells the right people."
* **Improve:** LOINC-coded catalogue with ranges per age/sex, order/result workflow, analyser (HL7 v2/ASTM) integration, acknowledgement tracking ("who saw the critical value and when").
* **Status:** 🟡 result entry only (no ordering).

## 3.8 Imaging: DICOM → PACS → FHIR
* **What:** the radiologist uploads a `.dcm`; it is parsed, stored in Orthanc, recorded, mirrored and indexed.
* **Why:** imaging is core to diagnosis and PACS/DICOM are the industry standards.
* **How:** `multipart` upload (≤ 100 MB) → `DicomService.parseDicomBuffer` reads tags (modality and StudyInstanceUID are mandatory — a non-DICOM or incomplete file ⇒ HTTP 400, nothing is invented) → `OrthancClient.uploadInstance` (best effort; failure keeps the record with `orthancStored:false`) → `imaging_studies` row → FHIR ImagingStudy upsert → index → `dicom.uploaded` event. Preview: `GET /hospital/imaging/:id/preview` streams Orthanc's PNG render.
* **Where:** `ai/dicom/dicom.service.ts`, `ai/dicom/orthanc.client.ts`, `ai/fhir/fhir.service.ts` (`toFhirImagingStudy`), lifecycle `recordImagingStudy`, UI `RadiologyPortal.tsx`.
* **Can go wrong:** the DICOM's own patient name/id is **not compared** with the patient chosen in the UI (wrong-patient risk — the most important TODO); one file = one study; identical files share one stored instance (handled on delete); the PACS is currently another project's server.
* **Explain it:** "Scans go into a proper image archive, with a thumbnail and a record in the patient's chart."
* **Improve:** patient-match check, multi-image studies, DICOMweb browsing and a real viewer (Cornerstone/OHIF), radiology report workflow (draft → signed), de-identification option. (TODOs are written in the source files.)
* **Status:** ✅ upload/preview/delete · 🟡 no viewer, no study grouping.

## 3.9 FHIR mirror
* **What:** records are copied to an HL7 FHIR R4 server so other systems could read them in a standard format.
* **Why:** interoperability is a hospital requirement and a strong demo point.
* **How:** `FhirService` maps Patient, Observation (labs), ImagingStudy. `FhirHapiClient` uses idempotent `PUT /Resource/{id}` (a retry never duplicates). Failure is reported (`fhirSynced:false`), never fatal. On patient delete: `DELETE /Patient/{id}?_cascade=delete`.
* **Where:** `ai/fhir/fhir.service.ts`, `ai/fhir/fhir-hapi.client.ts`, `ai/rag/fhir-dicom-ingest.service.ts` (re-sync), lifecycle.
* **Can go wrong:** **one-way** (the app never reads back); only 3 resource types and no standard codes (LOINC/ICD-10/RxNorm) — diagnoses, allergies, prescriptions, visits and vitals are **not** in FHIR; no retry queue (repaired at server start or via re-index); the FHIR server is shared with another app and also holds **50 demo patients (`patient-bulk-*`) created by this project's `npm run seed:fhir` script that do not exist in PostgreSQL**.
* **Explain it:** "A standards-based second copy, so other hospital systems could plug in."
* **Improve:** Condition/AllergyIntolerance/MedicationRequest/Encounter/Practitioner/DiagnosticReport, LOINC/ICD-10/RxNorm coding, `$validate`, outbox + retry worker, inbound sync, auth (SMART-on-FHIR), a dedicated FHIR server, remove/reset the stray bulk patients.
* **Status:** 🟡 partial (3 of ≈ 8 useful resources).

## 3.10 Visits: lifecycle, complete/reopen, delete
* **What:** every episode of care is a **visit** with a status. Statuses: `WAITING_TRIAGE`, `TRIAGED` (shown as "Waiting for doctor"), `IN_CONSULTATION`, `UNDER_REVIEW`, `TREATMENT`, `FOLLOW_UP`, `COMPLETED`, `CANCELLED`, `LEFT_WITHOUT_SEEN`. Admin can **delete** a patient permanently.
* **Why:** a person comes many times; the status belongs to the episode, not the person. History is kept, queues are exact, and the agent can reason about "where is this patient now".
* **How:** `visit-transitions.ts` is a declarative table (from → to, allowed roles, `auto` for steps the system performs, `noteRequired`). `VisitsService.transition()` is the **only** writer of `visits.status`: it locks the row, checks the table (409 impossible move, 403 wrong role, 400 missing reason), stamps timestamps/doctor/outcome, and writes a `visit_events` row. Workflow steps move visits automatically (triage → `TRIAGED`; first consultation → `IN_CONSULTATION`); manual moves use `POST /hospital/visits/:id/transition {to, note?, outcome?}`; `GET /hospital/visits/:id` returns the timeline and the transitions the caller may press. Clinical writes need an open visit (`VisitsService.requireActive`, 409 otherwise); reopening a completed visit needs a reason. One open visit per patient is enforced by a partial unique index. Delete requires `?confirm=<exact id>` and is ADMIN-only (also removes the visits and timeline); see 2.7. Events: `visit.updated` (every change), `patient.registered`, `doctor.consulted`, `patient.deleted`.
* **Where:** `src/hospital/visits/*` (`visit-status.ts`, `visit-transitions.ts`, `visits.service.ts`, `visit-summary.ts`), `patient-directory.service.ts` (list with current visit), `overview.service.ts`, lifecycle service, controller, UI `lib/visits.ts`, `VisitPanel.tsx`, `PatientManagementPanel.tsx`, `DoctorWorkbenchPortal.tsx`.
* **Can go wrong:** delete is irreversible (no soft-delete); no discharge summary yet; old chat threads still contain the deleted patient's text; backups are not purged; the department/specialist hand-off states exist but nothing drives them until the referral work (W7).
* **Explain it:** "The patient is the person, the visit is today's trip. Rules for moving a visit live in one table; one function applies them and records who did what."
* **Improve:** soft-delete with retention, discharge workflow, four-eyes deletion, purge chat/traces for deleted patients.
* **Status:** ✅ · 🟡 no discharge summary.

## 3.11 Waiting-room monitor
* **What:** a background job that alerts once when a patient waits too long.
* **Why:** unseen patients are a safety and satisfaction risk.
* **How:** `QueueMonitorService` runs every 60 s; visits in `WAITING_TRIAGE`/`TRIAGED` for more than `WAIT_ALERT_MINUTES` and with `waitAlertedAt IS NULL` raise `alert.unconsulted_patient` and are stamped so they are not re-alerted. `GET /hospital/lifecycle/queue` returns live wait minutes.
* **Where:** `queue-monitor.service.ts`, lifecycle `queue`, `checkUnconsultedPatientAlerts`.
* **Can go wrong:** timer runs in each server instance (two instances = duplicate alerts); no escalation if the first alert is ignored; the threshold is global.
* **Improve:** escalation ladder (30 → 45 → 60 min), per-department thresholds, job queue/leader election, assign-to-doctor.
* **Status:** ✅ basic.

## 3.12 Real-time gateway
* **What:** live push of events to the right roles.
* **Why:** a doctor should see a new patient/critical alert without refreshing.
* **How:** see section 2.6. The UI hook `useRealtime` refreshes affected lists on events.
* **Where:** `src/events/hospital-events.gateway.ts`, `apps/web-app/src/context/RoleContext.tsx`.
* **Can go wrong:** single-node only (multiple API instances need the Socket.IO Redis adapter); events are not persisted — a user offline misses them (alerts list is in memory); the bell shows only this session's alerts.
* **Improve:** Redis adapter, persisted notifications with read/unread, mobile push/SMS for critical alerts, acknowledgement.
* **Status:** ✅ · 🟡 not horizontally scalable, alerts not persisted.

## 3.13 Pharmacy, appointments, tasks
* **Pharmacy:** `GET /hospital/pharmacy/queue` lists recent consultations with prescriptions + stored safety result; `POST /hospital/pharmacy/audit` screens any list for any patient. ✅ screening · ⬜ dispensing, stock, approve/reject.
* **Appointments:** transactional with a pessimistic lock and unique partial indexes (no double booking), and they require an open visit. Booking with a `doctorId` also checks the doctor is available and the time is one of their real slots (`SpecialistService.assertBookable`); name and department are filled from the account. Free-text booking (no `doctorId`) still works for legacy use. API, AI agent and UI (reception + doctor "Book appointment") can book.
* **Tasks:** simple staff to-dos (`POST /hospital/tasks`); the receptionist "Notify doctor" button creates one with `assignedTo: 'doctor'` (free text, not a real user) (🟡).
* **Improve:** pharmacist verify/dispense workflow, appointment calendar UI + reminders, tasks assigned to real users with due times and status updates.

## 3.13b Specialists and availability
* **What:** specialists are users with role `SPECIALIST` and a `specialty`; each has weekly working hours and an availability switch. The system can answer "who is a cardiologist, and when are they free?" and book a real slot.
* **Why:** referrals (next work packages) must go to a real person with a real free time, not a typed name.
* **How:** `availability.ts` (pure, tested) turns weekly windows into free slots (skips past and already-booked slots, UTC) and validates a requested time is a real slot. `SpecialistService`: `find`, `specialties`, `getAvailability`, `nextFreeSlot`, `assertBookable`, `setAvailable`, `setWeeklyHours`. API: `GET /hospital/specialists`, `/specialties`, `/specialists/:id/availability`, `PATCH /specialists/:id/availability` (admin or the specialist themself), `PUT /specialists/:id/hours` (admin). Agent tools: `findSpecialists`, `getSpecialistAvailability` (read-only), and `bookAppointment` accepts `doctorId`. Seeded: `cardiologist` (Dr. Sarah Wilson), `neurologist` (Dr. Michael Chen), Monday–Friday 09:00–17:00 UTC, 30-minute slots (added automatically to existing databases when `SEED_USER_PASSWORD` is set).
* **Where:** `src/hospital/specialists/*`, `database/entities/doctor-availability.entity.ts`, `seed.service.ts`, UI `SpecialistPortal.tsx`, `AppointmentBooking.tsx`.
* **Can go wrong:** hours are UTC (no time zones, holidays, breaks or leave calendar); slot length is per window; a specialist with no hours has no slots; doctors (role DOCTOR) have no hours yet, so only specialists can be booked by `doctorId`.
* **Improve:** time zones, exceptions (leave/holidays), multiple locations, rescheduling and cancellation, waiting list.
* **Status:** ✅ basic · 🟡 no calendar exceptions.

## 3.16 Referrals, approvals, notifications and follow-up (what actually runs)
* **Flow:** doctor asks the agent *"Review P1004 and tell me if a specialist is required"* → the **rules engine** (`reviewReferralNeed`, `referral-rules.service.ts`, CARD/NEURO rules + evidence verifier) answers directly, no model, with evidence, missing info and "decision support only". *"Refer P1004 to cardiology"* → the agent calls `proposeReferral`, which **saves a pending `agent_actions` row** (linked to the patient's open visit, conversation and trace) and the chat returns `proposals`; the UI shows an **approval card**. Nothing exists until a human approves. Approve → `ActionExecutorService` creates the `consultation_request`, notifies the specialists of that specialty (in-app, with the patient's name), the primary doctor, and stores a patient notice (**stub channel: not actually delivered**), then **reads the record back**; the action ends `DONE` (verified) or `FAILED`.
* **Honest answers:** if the model says "done" but no write tool succeeded, `reconcileActionClaims` (guardrails.ts) replaces the text with what really happened ("No action was taken…" or "proposal waiting for approval"). Proposals are returned as structured data, not model prose. A patient NAME placed where an id belongs is resolved to the id; a patient the user did not name is refused (AgentContext binding).
* **Who may do what:** only the proposer (or an admin) can approve/decline an action; users list only their own actions (admin: all). Referral create/list: DOCTOR/NURSE/ADMIN. A SPECIALIST sees `GET /hospital/referrals/mine` (assigned to them, or unassigned in their specialty), can open a patient **only** through such a referral, and can complete only their own referral (`POST /hospital/referrals/:id/complete`: assessment, recommendation, treatment, followUp, optional `followUpTests[]` and `followUpDays`). One open referral per visit and specialty.
* **Completion:** referral → COMPLETED moves the visit IN_CONSULTATION → FOLLOW_UP (system transition, recorded with the specialist as actor) and notifies the requester.
* **Follow-up plan:** `POST /hospital/visits/:id/follow-up/propose` builds the plan **from the specialist's assessment** (appointment with that specialist after `followUpDays` or `FOLLOWUP_DEFAULT_DAYS`=28, one lab order per `followUpTests`, a coordinator task from the recommendation, a patient notice with the follow-up text); with no assessment it falls back to the doctor's consultation, and with neither it refuses. It is saved as a pending FOLLOW_UP action; on approval each item is **really created** (next free slot of that specialist, lab order, task, notice) and read back.
* **Where:** `src/ai/actions/*`, `src/ai/tools/actions/propose.tools.ts`, `src/hospital/{referrals,specialists,followup,notifications,labs}/*`, `src/ai/guardrails.ts`, `src/ai/routing/{intent,referral-view}.ts`; UI `NotificationCentre`, `ApprovalCard`, `PendingActionsPanel`, `ReferralsPanel`, `FollowUpPanel`, `SpecialistConsultations`, `LabResultForm`.
* **Tested by:** `npm run test:workflow` (visit, specialists, **referral loop** end to end against the running API), `npm run test:eval` (proposal persistence, honest wording, name→id, binding, rules answer without a model), unit tests `action-honesty.spec.ts`, `w5..w9`.
* **Can go wrong / not done:** notifications go to the specialists of the specialty, the primary doctor and the requester, not yet to nurses on the visit; patient notices are a stub; the streaming chat path cannot rewrite a false "done" after text is sent; approver is shown as a user id; the 3B local model needs minutes for a tool run and often mis-chooses tools (a strong model is still needed, W0.2).
* **Status:** ✅ backend verified end to end · 🟡 UI built and type-checked but not yet clicked through in a browser.

## 3.14 Patient summary (role-aware 360° view)
* **What:** one function that builds the chart view for REST and for the AI.
* **Why:** one place decides "who may see what" (minimum necessary), so screens and AI cannot disagree.
* **How:** `PatientSummaryService.summary(id, role)` returns sections only if the role is allowed: demographics for everyone; conditions, allergies, medications, labs, vitals, consultations, imaging, appointments per role; plus **`medicationSafetyAlerts`** (the current medications screened against allergies/renal function — computed, not inferred).
* **Where:** `src/hospital/patient-summary.service.ts`; used by the controller and the `getPatientSummary` tool.
* **Can go wrong:** the role matrix is code, not data (changing it needs a deploy); sections are capped (10 labs, 3 vitals, 3 consultations).
* **Improve:** policy-as-data (editable roles/permissions), break-glass access with justification and audit, patient consent flags.
* **Status:** ✅.

## 3.15 Seed data
* `SeedService`: 9 staff accounts on first start (bcrypt; the two specialists are also added to older databases) with the 3 demo patients below, each placed at a different visit stage (P1001 in consultation, P1002 waiting for doctor, P1003 waiting for triage) by walking the real workflow, 3 demo patients (`P1001 Eleanor Vance`, `P1002 Marcus Brody`, `P1003 Sophia Martinez`) and 2 labs for P1001 (HbA1c 7.8 %, creatinine 1.9 mg/dL). `SEED_DEMO_DATA=false` skips patients.
* **Can go wrong:** the seeded password is shared by all accounts; demo patients appear in a real database if not disabled.
* **Improve:** force password change at first login; separate demo seeding command.
* **Status:** ✅.

---
# 4. AI concepts (the agent)

## 4.1 The big idea: retrieve first, then write
* **What:** the chat assistant does **not** rely on the language model to remember or choose what data to look at. The *server* works out what the question needs, fetches it from the database through role-checked tools, and — depending on the question — either answers directly from the data or lets the model write the answer from that data only.
* **Why:** testing showed a small local model (3B) picks the wrong tool, ignores data it is given, drops list items, and invents explanations. In medicine a wrong confident answer is worse than none. Moving the *facts* out of the model's hands makes answers correct on any model; the model is used only for language and reasoning.
* **How (the lifecycle of one chat message, in code order — `AiService.chat`):**
  1. A `RunRecorder` starts (trace id, timings).
  2. `LlmProvider.getModel()` — if no model is configured ⇒ HTTP 503 with a clear message.
  3. **Memory:** load/create the thread (a thread belongs to one user; another user gets 404); build the context window (newest turns that fit ≈ 3000 tokens; older turns folded into a summary by the model, if needed).
  4. A **PHI session** is created (patient names loaded from the DB).
  5. **Intent** is classified (cheap regexes): `list`, `waiting`, `overview`, `policy`, `crossSearch`, `medication`, `write`, `triage`.
  6. **Context is gathered** (`gatherContext`): patients named in the message (by id, full name, or an unambiguous first/last name; words like "patient" are in a stoplist) — or, for follow-ups like "him/her", the **active patient of the thread**; unknown ids ⇒ a "not found" note; then the lists/overview/policy/cross-patient searches the intent calls for; if nothing matched and it is not a write/triage request, a **fallback policy search** whose hits are kept only if similarity ≥ 0.60. All retrievals go through the same role-checked tools (`runDirect`) and are traced as `auto` tool calls.
  7. **Decide who answers** (first match wins): triage numbers parsed ⇒ calculator · overview/waiting counts ⇒ database numbers · only-unknown-id ⇒ "No patient with id … exists" · pronoun with nobody in focus ⇒ "Which patient do you mean?" · pure factual lookup of one chart ⇒ rendered chart · pure "list patients" ⇒ rendered list · otherwise the **model**.
  8. If the model is used: **grounded mode** (no tools, "answer only from CONTEXT") when context was found and the request is not a write/medication/triage; otherwise **agent mode** with the role's tools (max 8 steps). The call goes through timeout → retry/backoff → circuit breaker.
  9. If the model printed a tool call as text (a llama quirk) it is nudged once, then replaced by a safe message.
  10. **List completeness** (model-written list answers): any patient the model dropped is appended from system data.
  11. **Guardrails** check the answer (section 4.10); the status/notes go back to the UI.
  12. The two messages are saved; the thread's active patient is updated; the run is saved as a trace; the response includes `mode`, `toolCalls` (with `auto` and `durationMs`), `citations`, `guardrailStatus/Notes`, `traceId`, `memory`.
* **Where:** `src/ai/ai.service.ts` (≈ 600 lines — the orchestrator), `src/ai/routing/*`, `src/ai/tools/*`.
* **Can go wrong:** the regex intent router is English-only and can misroute unusual phrasing (it fails *safe*: unrouted questions go to the tool agent, which is the older behaviour); a question mentioning two patients goes to the model with both charts; `ai.service.ts` is large and should be split.
* **Explain it:** "Like a good analyst: first pull the right files, then write the answer from the files — and for simple lookups, just hand over the printout."
* **Improve:** a small classifier model (or embedding-based routing) instead of regexes, multilingual intents, split `AiService` into Router / ContextGatherer / Answerer, streaming answers.
* **Status:** ✅ (verified: 10/10 data/tool choice and 10/10 grounded answers on the live local model).

## 4.2 Model providers and local models
* **What:** one place that returns the chat model; five back-ends.
* **Why:** switch between private local models and stronger cloud models without touching the logic; tests can inject a scripted model.
* **How:** `resolveModel()` reads `LLM_PROVIDER` (`ollama`, `google`, `groq`, `openai`, and `cli_proxy`/`anthropic`, which talks to an Anthropic-compatible proxy; it deletes `tool_choice` from requests for compatibility). It returns `null` when the provider's key is missing, so the API answers 503 instead of silently using another provider. `LlmProvider` wraps it and offers `useModel()` — the seam the evaluator uses to inject scripted models. **Ollama:** `ops/Modelfile.hospital` builds `llama3.2-hospital` (8192-token context because 15 tool definitions + a chart do not fit the default 4096; temperature 0.1). `OllamaWarmupService` loads the chat + embedding models at start and re-pings every 4 min so there is no 5-minute-idle cold start.
* **Where:** `src/ai/llm/model.ts`, `llm-provider.ts`, `warmup.service.ts`, `ops/Modelfile.hospital`.
* **Can go wrong:** the default when `LLM_PROVIDER` is unset is now `cli_proxy` (was OpenAI) — if the proxy variables are missing the API returns 503; local 3B on CPU takes 10–100 s to write an answer and reasons poorly; model names are not validated at start.
* **Explain it:** "The brain is replaceable: private and free locally, or stronger in the cloud."
* **Improve:** startup self-test of the model, fallback chain (primary → secondary provider), per-role models, GPU hosting, streaming.
* **Status:** ✅ · 🟡 no automatic fallback model.

## 4.3 Embeddings and the vector store (the agent's "training" on your data)
* **What:** every patient record and every policy is cut into chunks, embedded as number vectors, and stored in PostgreSQL (pgvector) so the agent can search by *meaning* **and** by exact words. It is retrieval, not model training: new data is searchable immediately.
* **Production search path (one path, used by every tool, the referral engine and `retrieval-check`):** `VectorRagService.searchPolicies / searchPatientRecords` = **hybrid**: (1) vector similarity (cosine, HNSW) and (2) PostgreSQL full-text search where ANY meaningful word of the question matches (`rag/query-terms.ts`: stop-words removed, OR query, ranked with `ts_rank_cd(..., 1)` so a short chunk about the words beats a long one that merely mentions them), fused with Reciprocal Rank Fusion (`fuseRanks`). Every hit carries `similarity` (cosine) so cut-offs such as the 0.60 "plain-language policy" threshold still mean the same thing.
* **Document types:** every policy chunk has metadata `docType` = `policy | sop | guideline` (front matter `---\ndocType: guideline\n---` at the top of the markdown file; default `policy`; uploaded documents may carry it too) and its `title`. The question's SHAPE gives a rank bonus, never a filter: "who handles / who is responsible / what is the process" prefers policy+SOP; "criteria / indications / when to refer" prefers guidelines. The referral engine searches guidelines only.
* **Chunks carry their context:** the embedded text is `Title (docType) - Section heading` + the bullets, so a bare list still knows what it is about.
* **Components:** `EmbeddingProvider` (OpenAI 1536, **Ollama `nomic-embed-text` 768** with search_document/search_query prefixes, or a local hash fallback); `PgVectorStore` (table `document_embeddings`, `vector(N)`, HNSW cosine index, GIN full-text index `document_embeddings_tsv2`); `VectorRagService` (chunking on markdown headings, ≤1000 chars; `ingest()` skips unchanged chunks by SHA-256 of model+embedded text; query-embedding LRU cache); `RecordDocumentBuilder` (stable source keys `patient-…`, `visit-…`, `consultation-…`, `vitals-…`, `lab-…`, `imaging-…`); `FhirDicomIngestService` re-checks everything at start.
* **Where:** `src/ai/rag/*`.
* **Measured:** `retrieval-check` **29/29** (new data searchable at once; cross-patient and policy questions; 13 policy questions incl. 5 paraphrases that were not tuned for; delete cleanup). Live end-to-end with the real model: `tests/workflow/rag-answers-live.mjs` (12 policy questions: the answer must contain the written fact AND cite the right document; the last has no answer in the documents and must not be invented).
* **History (honest):** until this phase the "hybrid" code existed but no tool called it, and its keyword half required every word of the question to match, so it degraded to vector-only. The failing case "urgent consultation request who handles it" was a ranking problem (flat cosine scores 0.60-0.68, new guideline chunks outranking the policy chunk), not a storage problem.
* **Can go wrong:** appointments and tasks are not indexed (read through tools); OpenAI embeddings would send record text to OpenAI; cosine scores are model-specific (re-tune cut-offs if the embedding model changes); a question with no matching document still returns the nearest chunks, which is why answers must cite and the grounded prompt says "not in the data I retrieved".
* **Improve:** reranking with a cross-encoder, chunk-size evaluation, index appointments/tasks, `ef_search` tuning, background re-embedding queue. A separate vector database (Chroma etc.) is NOT needed at this size and would not fix any of the observed problems.
* **Status:** ✅ (hybrid is now the production path).

## 4.4 Knowledge documents (admin upload)
* **What:** the admin uploads policies/protocols in the app; the agent can answer from them immediately.
* **Why:** policies change; staff, not developers, must be able to maintain them.
* **How:** `POST /admin/knowledge` (multipart `file` + optional `title`, or JSON `{title, content}`). Types `.md`, `.txt`, `.pdf` (text-based PDFs via `pdf-parse`); ≤ 5 MB, ≤ 200 000 characters. Text is stored in `knowledge_documents` (source of truth) and indexed; **if indexing fails the document is removed — never half-saved**. The filename is never used as a path (an earlier endpoint that wrote to disk was removed). `GET` lists built-in (the 6 files in `knowledge/`, read-only) and uploaded documents with chunk counts; `DELETE` removes an uploaded one and its chunks; `reindex` rebuilds everything. Citations show the source `filename (KB-xxxxxx)` and section heading.
* **Where:** `knowledge-documents.service.ts`, `admin.controller.ts`, UI `KnowledgeBasePanel.tsx`, `knowledge/*.md`.
* **Can go wrong:** scanned PDFs (no text) are rejected — no OCR; no versioning (re-upload creates a new document); a malicious document could contain instructions — the agent is told to treat document text as data, but this is mitigation not proof; no per-document access control.
* **Explain it:** "Drop a PDF in; thirty seconds later the assistant can quote it."
* **Improve:** OCR, versions + effective dates + approval workflow, document ownership, access scopes, chunk preview, "documents the agent cited most" analytics, DOCX support.
* **Status:** ✅ · 🟡 no versioning/approval.

## 4.5 Tools and the tool factory (Mastra tool calling)
* **What:** typed actions the agent may call. 15 tools; each defines a name, description, **zod input schema**, **allowed roles** and a `run` function.
* **Why:** "tool calling" is how an agent reaches real data/actions. Defining tools as plain objects keeps them framework-independent and easy to test; adding a capability = adding one object.
* **How:** `ClinicalToolsFactory` builds, per request, only the tools the caller's role may use and wraps each in Mastra `createTool`: unmask model inputs (placeholders → real values), run with a 10 s timeout, record a trace entry (name, args, duration, success), mask the output (PHI), and convert any exception into `{success:false,error}` (so the model can read the failure). `runDirect` runs a tool server-side for the retrieve-first step with the same checks. Write tools validate input with the **same class-validator DTOs as the REST API** (`validate-dto.ts`), and number/boolean/list/enum arguments are parsed leniently (`loose-schema.ts`: "91%" → 91, "true" → true, one string → list) because small models format arguments sloppily.

  | Tool | Roles | Purpose |
  |---|---|---|
  | `searchPatients` | all | list/find patients by name/id and stage (waiting, active, finished) |
  | `getPatientSummary` | all (sections trimmed by role) | full chart incl. safety alerts |
  | `getHospitalOverview` | doctor, nurse, admin, receptionist, coordinator | counts |
  | `getAppointmentsAndTasks` | doctor, nurse, receptionist, coordinator, admin | schedule/to-dos |
  | `searchHospitalPolicies` | all | semantic policy/document search (+citations) |
  | `searchClinicalRecords` | doctor, nurse, pharmacist, admin | semantic search across (or within) patient records |
  | `verifyMedicationSafety` | doctor, nurse, pharmacist, admin | the safety shield |
  | `assessTriage` | doctor, nurse, admin | NEWS2/SIRS/ESI calculation (no save) |
  | `checkUnconsultedAlerts` | doctor, nurse, receptionist, admin | long waits |
  | `proposeRegistration` | receptionist, admin | prepare a patient registration for approval (checks duplicates first) |
  | `proposeConsultation` | doctor, admin | prepare a consultation note for approval (medication-safety preview on the card) |
  | `findSpecialists` | doctor, nurse, receptionist, coordinator, admin | specialists + specialties |
  | `getSpecialistAvailability` | same | free slots + next free slot |
  | `proposeAppointment` | doctor, nurse, receptionist, admin | prepare a booking; rejects taken/unknown slots and offers real free ones |
  | `proposeReferral`, `proposeLabOrder`, `proposeFollowUp`, `proposeTask`, `proposeNotification` | by role (see `tool-roles.spec.ts`) | prepare the change for approval |
  | `queryLiveHapiFhirPatients` | admin | what FHIR holds (marginal) |
  | `queryLiveOrthancStudies` | radiologist, admin | what the PACS holds (marginal) |
* **Where:** `src/ai/tools/*` (`tool-registry.ts` = types + `ToolTrace`; `clinical-tools.factory.ts`; `hospital.tools.ts`).
* **Can go wrong:** **no agent tool writes data any more** (the four direct write tools were removed in the 2026-10-09 hardening): every change is a `propose*` tool that saves a pending proposal (section 4.5c). The model might still never be offered the right tool; a tool that returns `{success:false}` is now recorded as a FAILED call in the trace; tool descriptions cost prompt tokens.
* **Explain it:** "The assistant only gets the buttons its role is allowed to press, and every press is logged and timed."
* **Improve:** per-tool rate limits, tool result caching for repeated identical calls inside a request, richer tools (lab trends, discharge summary).
* **Status:** ✅ (writes are behind approval).

## 4.5b AgentContext (what the agent knows and may do, per request)
* **What:** before the model runs, the server builds an `AgentContext`: the user (id, role, specialty), the patient this request is about, the patients write tools may act on, that patient's open (or latest) visit, conversation info, and the **tools visible in this state**. Ids and statuses only — no names.
* **Why:** (1) safety: a model — or an instruction hidden in a note or document — must not be able to act on a patient the user never named; (2) state: nobody should book or consult on a finished visit; (3) traceability: a trace shows exactly what the agent could see and do.
* **How:** `AgentContextBuilder.build` (subjects from `gatherContext` = patients named in the message or "him/her", plus the conversation's current patient; visit via `VisitsService`) then `ClinicalToolsFactory.applyPolicy` → `applyToolPolicy`. Tools declare `requires: { openVisit?, patientBound? }` (e.g. `recordDoctorConsultation`, `bookAppointment`, `createStaffTask`); the policy (`context/tool-policy.ts`, pure and unit-tested) withholds `openVisit` tools when the visit is finished and says why in the prompt (`describeContext`), and every `patientBound` call is checked at run time: a `patientId` outside `allowedPatientIds` is refused with an explanation and nothing is written. Read tools can still look up any patient the role may see ("search"). The run stores `contextHash` + `context` (`agent_runs`).
* **Where:** `src/ai/context/{agent-context,tool-policy,agent-context.builder}.ts`, `ai.service.ts` (built after `gatherContext`), `clinical-tools.factory.ts` (`applyPolicy`, `build`), `agent.ts` (`describeContext`), `run-recorder.ts`.
* **Can go wrong:** the allowed set is name/id matching on the message (a typo'd name yields no patient, so a write is refused rather than guessed); a confirmation like "yes" relies on the conversation's current patient; read tools are not bound; the context is a snapshot at request start (a visit that changes mid-request is still caught by the service layer's own 409).
* **Explain it:** "Before the AI answers, the system hands it a work order: this user, this patient, this visit, these tools. Anything outside the work order is refused."
* **Improve:** show the context in the admin run view, bind read tools by purpose, add referral/approval state (W6/W7), compare context hashes across runs.
* **Status:** ✅ (W3) · 🟡 not yet visible in the UI.

## 4.5c Actions: proposal → approval → execution → verification (the 2026-10-09 hardening)
* **What:** the only way the agent changes anything. The agent calls a `propose*` tool; the system validates, saves a pending proposal and shows a card; a human approves; the executor carries it out and reads it back.
* **Proposal time (`ActionValidatorService`):** nothing reaches a card that cannot work: unknown patient, no open visit, appointment slot taken or in the past (the answer lists real free slots), duplicate open referral, registration that matches an existing patient (the matches are returned), unknown notification recipient (a role like NURSE resolves to every account with that role, a specialty to its specialists), consultation medication-safety preview (shown on the card; a critical finding needs an override note). The model is told exactly what is missing and must ask the user.
* **Autonomy tiers (current implementation is the source of truth):** ASK (one Approve click): REFERRAL, APPOINTMENT, REGISTER_PATIENT, STAFF_TASK, LAB_ORDER, NOTIFICATION, FOLLOW_UP. ASK_HUMAN (written clinician note): CONSULTATION, approvable only by the clinician who proposed it (it is signed in their name). NEVER: DELETE_PATIENT, MODIFY_ROLES, DELETE_KNOWLEDGE (and any unknown type: fail closed). CLOSE_VISIT, REOPEN_VISIT, COMPUTE_NEWS2, CREATE_SELF_TASK are catalogued but have no executor, so they can never be proposed (`executable:false`). The product brief listed referrals/appointments/follow-ups as ASK_HUMAN; the code has them as ASK. Not changed: a decision for the clinical owner.
* **Typed replies (`PendingActionsService`):** only the WHOLE message "yes / confirm / go ahead / do it / approve …" approves, and only a proposal made in THIS conversation within the last 10 minutes; older ones need "confirm ACT…" or the card. "ok", "sure", "correct" are acknowledgements and never approve. "yes, what are his labs?" is a new question, not a confirmation. "no / cancel" declines. With two proposals waiting it asks which. A new conversation has nothing to confirm.
* **Approval is atomic:** a conditional update (PENDING→EXECUTING) means a button click and a typed "yes", or a double click, run the executor once; the loser gets "already being handled" (or the finished result). Decline cannot overwrite an approval. An action left EXECUTING by a crash is marked FAILED with "outcome unknown" by a sweeper (never retried blindly).
* **Verification:** each type reads its record back (registration: patient stored; appointment: found for that patient; task; lab order; referral; consultation; follow-up items one by one). A multi-item action that fails part-way is FAILED with `partial:true`, keeps what was created and says which items failed. Patient notices go through a STUB channel and say so.
* **Honest text:** `reconcileActionClaims` replaces "done" with what happened, and now also replaces "prepared for your approval" when no proposal was actually saved (with the refusal reason). A proposal card shows the real status of an identical earlier request (never a false "waiting").
* **Missing details:** `action-slots.ts` asks at once, by rules and without a model ("Which patient is the appointment for?"; registration lists exactly the missing fields).
* **Where:** `src/ai/actions/*`, `src/ai/tools/actions/propose.tools.ts`, `src/ai/query/{lexicon,action-slots}.ts`, `src/ai/guardrails.ts`.
* **Tested by:** unit specs (`atomic-approval`, `pending-actions`, `action-slots`, `action-honesty`, `w6-actions`), the agent evaluation (4.14) and `npm run test:workflow`.
* **Not done:** approval-time re-validation of the visit/patient state beyond what the services check; an append-only audit log (rows are updated in place); streaming chat is now the same pipeline as chat (one chunk).

## 4.6 Structured routing: QueryPlan, confidence, handlers
* **What:** how a question is understood and who answers it. `src/ai/query/` (+ `src/ai/routing/*` renderers).
* **Flow:** question -> **L1 deterministic parser** -> `QueryPlan {intent, entity, scope, filters, patientRef, confidence, alternatives, source, evidence}` -> (**L2** model planner only if L1 is below the minimum confidence or two readings compete) -> `decidePlan` = **HANDLE / CLARIFY / AGENT** -> handler registry -> deterministic answer, grounded model, or tool agent. The plan is the single source of truth; the old boolean "intent flags" are derived from it (`plan-to-intent.ts`).
* **L1 (`l1-parser.ts`, wording in `lexicon.ts` as tables):** frames (count / list / lookup / ownership / rule / review), entities (patient, appointment, task, lab, vitals, medication, queue, specialist, staff, policy ...), specialties from the DATA (`VocabularyService`) with everyday synonyms (heart -> Cardiology), a change request = a clause that STARTS with a verb, "yes/no" replies, calculations from vital-sign values, "what does a rule require" (must / required / at what level ...), conversation recall. Typos in question words are repaired against the vocabulary; names are resolved separately. Each reading gets a confidence; close rivals lower it. Thresholds: `ROUTE_CONFIDENT` 0.75, `ROUTE_MINIMUM` 0.5.
* **L2 (`l2-planner.service.ts`):** one tool-free `generateObject` call returning a validated QueryPlan. Safety envelope: it can classify but never create an ACTION/CONFIRM/DECLINE, patient ids come only from the message, confidence is capped at 0.85. `ROUTE_L2=off` disables it. Measured on the local 3B model: 12/12 answered, intent 11/12, entity 10/12, ~7 s each, 0 actions from questions (`tests/evaluation/routing/routing-l2.ts`).
* **Never guess:** a name equally close to two people, or a question with two competing readings, is asked back ("Did you mean A or B?", "What would you like me to count: ...?"). `hospital/person-resolution.ts` resolves patients AND staff together.
* **Handlers (`handler-key.ts`, `services/ai-router.service.ts`):** `count.overview` (only the figures asked), `count/list.specialists`, `count/list.staff`, `count.unsupported` ("I do not keep a count of ..."), `list.waiting`, `list.patients`, `lookup.chart`, `lookup.staff`, `review.referral` (rules engine, no model), `calculate.vitals` (NEWS2), `policy.rag` (hybrid RAG -> grounded model), `search.records`, `clinical.agent`, `action.agent` (propose* tools -> approval card), `pending.confirm/decline` (`PendingActionsService`: replies apply only to proposals pending in THIS thread), `smalltalk`, `clarify`, `agent.fallback`.
* **Traceability:** `agent_runs.route` stores intent, entity, scope, filters, confidence, source (L1/L2), decision, handler, alternatives; `/admin/agent/metrics` returns `routing` (by handler, L2 rate, clarify rate, agent-fallback rate, average confidence).
* **Tests:** `query/query-plan-golden.spec.ts` (170+ realistic questions incl. typos, short/long, follow-ups, ambiguity, adversarial; reports L1 accuracy and wrong-route rate), `routing/routing-golden.spec.ts`, `query/query-router.spec.ts`, `query/handler-key.spec.ts`, evaluator "structured routing" section, `tests/workflow/chat-golden.mjs` (live, compared with REST data).
* **What went wrong before (and the structural fix):** any "how many" returned the patient overview; words like *update, record, order, discharge, give* turned reads into actions/medication questions; "how long must vitals stay stable ..." asked "which patient?"; names were matched exactly. Now: counts are routed by the thing counted, actions by sentence structure, rules by the shape "what does a rule require" when no particular patient is named, names by a scored resolver.
* **Can go wrong:** the L1 lexicon is still English words in tables (unusual phrasing falls to L2/clarify/agent, which on the 3B model is slow); L2 accuracy is limited by the local model; deterministic handlers can only answer what the system stores.
* **Status:** ✅ implemented and measured; browser verification pending.

## 4.7 Grounded mode vs agent mode
| | Grounded mode | Agent mode |
|---|---|---|
| When | server found context; not write/medication/triage | no context found, or actions, or medication/triage |
| Tools | none | the role's tools (max 8 steps) |
| Instruction | "Answer ONLY from CONTEXT; if absent say *That is not in the data I retrieved*; list every item; report safety alerts first; summarise when asked" | rules about calling tools, confirming writes, ignoring instructions found in data |
| Failure style | says "not in the data" | may call wrong tool / ask odd questions (weak models) |
* **Where:** `src/ai/agent.ts` (`buildInstructions`, `buildGroundedInstructions`).
* **Improve:** hybrid mode that lets a strong model call extra tools after seeing the context.

## 4.8 Privacy: PHI masking
* **What:** names, phones, emails and SSNs are replaced with placeholders before the model sees anything; restored in the answer.
* **Why:** cloud models should not receive identifiable patient data.
* **How:** `PhiSession` (per request): all patient names loaded from the DB (cached 30 s) are matched as whole words, case-insensitively, longest first; each distinct value gets a stable placeholder (`[PATIENT_1]`…); phone/email/SSN patterns too. `maskDeep` masks every string in tool output **and drops** `phone`, `dob`, `telecom`, `passwordHash` keys; `unmaskDeep` converts placeholders the model used back to real values for tool inputs; `restore` fixes the final text. Stored traces keep masked arguments.
* **Where:** `src/ai/security/phi-session.ts` (pure, unit-tested), `phi-anonymizer.service.ts`.
* **Can go wrong:** **dictionary-based** — a name never seen before (typed free-text for the first time, e.g. while registering) is not recognised; only *full* names are matched (first names alone are not); patient ids and clinical details still reach the model (an id is pseudonymous, not anonymous); with OpenAI **embeddings** the raw text is sent (see 4.3).
* **Explain it:** "The model works on 'Patient 1', never 'Eleanor Vance'."
* **Improve:** a real de-identification step (NER / Presidio), tokenised ids, a BAA-covered or self-hosted model for production, output scanning for unmasked names.
* **Status:** 🟡 good defence-in-depth, not a compliance guarantee.

## 4.9 Document generation
* **What:** `POST /ai/documents` drafts **SBAR** (nurse/doctor/admin), **prior-authorization letter** (coordinator/doctor/admin) and **discharge instructions + translation** (coordinator/doctor/nurse/admin) from a patient's chart.
* **How:** chart assembled (labs, vitals, consultations, imaging) → masked → a tool-less "writer" agent with strict rules ("only the chart JSON; write 'not documented' when missing; never invent codes, dates, policy numbers") → restored. Every response carries a disclaimer ("AI-generated draft… must be reviewed"); runs are traced (`kind: document`).
* **Where:** `AiService.generateDocument`, UI `NurseWardPortal.tsx`, `CareCoordinatorPortal.tsx`.
* **Can go wrong:** quality depends on the model (a 3B model's translation/legal tone is weak); no check that the output matches the chart; nothing is submitted to any payer.
* **Improve:** fact-check pass (every claim must map to a chart field), templates per payer, human approval + e-signature, save drafts, real translation service, diff view.
* **Status:** 🟡 drafts only.

## 4.10 Guardrails
* **What:** checks run on the finished answer.
* **How:** (1) any failed tool ⇒ warning; (2) a patient id (`P1001`/generated) in the answer that never appeared in any tool input/output or in the user's/earlier text ⇒ warning ("not retrieved from any record"); (3) raw tool-call JSON ⇒ nudge/replace; (4) list completeness (`appendOmittedPatients`); (5) **claim reconciliation** (a "done" or "waiting for approval" claim without a real executed action / saved proposal is replaced); (6) retrieved record text is fenced as DATA (`data-fence.ts`) so a note cannot pose as an instruction; status `VERIFIED_SAFE` or `WARNING` + notes shown in the UI.
* **Where:** `src/ai/guardrails.ts` (+ spec).
* **Can go wrong:** it cannot detect a wrong *fact* about a real patient when the model had the data (e.g. misreading a value) — which is why factual lookups are rendered without the model; "VERIFIED_SAFE" means "passed these checks", not "clinically verified".
* **Improve:** claim-by-claim verification against the context (numbers/dates must match), an LLM-as-judge pass for reasoning answers, red-team test set (prompt injection, jailbreaks), toxicity/PII output filters.
* **Status:** 🟡.

## 4.11 Memory and context management
* **What:** conversations persist on the server; long ones are summarised; each thread remembers the patient it is about.
* **Why:** follow-ups ("what medicines did the doctor give **him**?") must work; the model's window is limited.
* **How:** `ConversationMemoryService`: threads/messages in Postgres; a thread is private to its user; `selectWindow` keeps the newest messages that fit ≈ 3000 estimated tokens (chars/4; at least the last 2 always kept); older turns are summarised by `SummarizerService` (names masked before, restored after; if summarisation fails the request still answers and tries again next turn); `activePatientId` is set from the last successful tool/retrieval that carried a `patientId` and is used to resolve pronouns and injected into agent instructions. UI: new chat, thread list, reopen, delete.
* **Where:** `src/ai/memory/*`, entities `chat-thread`, `chat-message`, UI `MastraChatDrawer.tsx`.
* **Why not Mastra's own Memory:** it needs extra packages (`@mastra/memory`, a storage adapter) that were not installed, and we needed our own per-user privacy, masking and patient-focus rules; it was a build-time decision, **not** a verified limitation of Mastra. (See roadmap: moving to Mastra Memory is an option.)
* **Can go wrong:** one patient in focus per thread (the last one); summary quality depends on the model; chat history contains PHI and is never purged automatically (also when a patient is deleted); token estimate is approximate; no memory across threads.
* **Explain it:** "Each conversation has a notebook and a sticky note saying who we're talking about."
* **Improve:** Mastra Memory/working-memory + semantic recall, long-term user preferences, retention policy, purge on patient delete, multi-patient focus.
* **Status:** ✅ short-term · ⬜ long-term/cross-thread memory.

## 4.12 Reliability (failure handling)
* **What:** protection against a slow or failing model provider.
* **How:** `withTimeout` (default 45 s per model call, 10 s per tool) → `withRetry` (2 retries, exponential backoff with jitter from 500 ms; retries **only** transient errors: 408/429/5xx, network resets, timeouts, "rate limit/overloaded" messages) → `CircuitBreaker` (opens after 5 consecutive provider failures; fails fast for 30 s with HTTP 503 "temporarily unavailable"; then one trial call; user errors never trip it). Retries are recorded on the trace. Failures return a clean message plus a `traceId` (no stack traces).
* **Where:** `src/ai/reliability/resilience.ts`, `llm-runner.ts` (+ spec, + 8 eval checks).
* **Can go wrong:** breaker state is in memory per instance; no fallback provider; timeouts of 120 s (set for the slow local model) make failures slow to surface.
* **Improve:** provider failover, bulkheads (limit concurrent model calls), request queue, health-aware routing, Redis-shared breaker.
* **Status:** ✅ (tested).

## 4.13 Observability, metrics and drift
* **What:** every AI request becomes a **trace**; aggregates reveal when the agent's behaviour changes ("drift").
* **How:** `RunRecorder` records spans — `memory` (load-thread, build-context, retrieve-context, build-agent-context), `llm` (agent.generate), `tool` (each call, with masked args, duration, success) — plus retries, token usage, guardrail status, error; saved to `agent_runs`, and one JSON log line per run (`event: "agent.run"`, grep by `traceId`). `computeMetrics` (error rate, guardrail-warning rate, tool-failure rate, "answered without any tool" rate, average tool calls, p50/p95 latency, average tokens, top tools, models) over the last N hours vs a **baseline of the preceding 7 days**; `detectDrift` flags rises ≥ 10 pp (critical ≥ 25 pp), p95 latency ≥ 1.5× (critical ≥ 2.5×), average tool calls ±40 %, and a primary-model change — but only when both windows have ≥ 20 runs. Admin UI: metric cards, breaker state, drift box, top tools, run table, waterfall for one run.
* **Where:** `src/ai/observability/*`, admin endpoints `GET /admin/agent/metrics|runs|runs/:id`, UI `AgentObservability.tsx`.
* **Can go wrong:** with few runs (like a demo) drift shows "not enough data" by design; metrics are computed on request in JS from up to 5 000 rows (fine for a POC); no alert is sent when drift is detected; no export to OpenTelemetry/Datadog; direct answers count as runs with 0 LLM calls (fine, but changes averages).
* **Improve:** OpenTelemetry export, alerts (Slack/e-mail) on drift, per-role dashboards, cost tracking, user feedback (thumbs up/down) feeding the eval set, sampling/retention policy.
* **Status:** ✅ in-app · 🟡 no external observability or alerting.

## 4.14 Evaluation and regression tracking
* **What:** automated, measurable tests of the *agent*, not just the code. All layers are in `tests/evaluation/` (see `tests/evaluation/README.md`):
  1. **Unit tests** (`npm test`): routing golden set (`src/ai/query/query-plan-golden.spec.ts`, rules only), pending-reply rules, atomic approval, claim honesty, validators, data fence.
  2. **Behaviour evaluation per role** (`npm run test:agent-eval`, **1,565 scenarios**: about 170 generated for each of the 8 roles plus 199 hand-written core scenarios). It runs the **production path** (`AiService.chat`) against the seeded patients. The expected result of every generated scenario comes from an independent **oracle** (`tests/evaluation/agent/oracle/roles.ts` = who may see/do what; `facts.ts` = seeded facts), not from copying what the system said. Families per role: chart sections x 3 patients x 3 phrasings (including typos), hospital figures and staff/specialist questions, 16 policy questions (right document cited), one scripted call for each of 19 read and assessment tools (offered vs not offered), every propose tool (allowed -> pending proposal, denied -> no proposal and an honest answer), proposals rejected before a card exists, confirmations (yes / ok / no / mixed message / decline), prompt injection, ambiguity, unsupported questions, unknown patients, missing details, memory (pronouns, patient switch, new conversation, incidental reads).
  3. **Order of evaluation:** (a) deterministic checks (handler, intent, required/forbidden text, tools called and succeeded, proposal count/type/status, model calls, database effects) and the **critical-failure gate** (8 critical types; any one exits 1); (b) **semantic layer** (`semantic.ts`): the answer and a plain-words reference are embedded with the local embedding model and compared; low similarity is flagged for a person to read; (c) a **coverage table** (role x behaviour, tools, workflow stages). Every critical failure is read and classified by a person (agent defect or wrong expectation) before anything is changed.
  4. **System evaluator** (`npm run test:eval`, 149 checks vs `system/baseline.json`): wiring, RBAC, memory, reliability, guardrails, observability.
  5. **Retrieval** (`npm run test:retrieval`, 29 checks) and live-model scripts (`tests/workflow/rag-answers-live.mjs`, `npm run test:routing-l2`) that need the local LLM.
* **Is the gate real? (mutation test, 2026-10-09):** temporarily letting the receptionist see lab results made 9 scenarios fail with UNAUTHORIZED_PHI_ACCESS; the change was reverted.
* **Numbers (2026-10-09, this machine):** unit tests all passing · behaviour evaluation 1565/1565, 0 critical failures, 792 answers scored semantically (mean similarity 0.83, none flagged) · system evaluator 149/149 · retrieval 29/29. First run of the per-role suites found real defects, all fixed: a specialist or role without the list tool was told "Nobody is waiting" (false); "I have done it for you" and "Your role was changed" were not recognised as false success claims; staff questions answered under the wrong handler label; "staff tasks" counted as staff; "doctors in cardiology" asked back instead of listing the cardiologists; "prescribed for" treated as a drug-safety question; the waiting-longest question was answered by a hard-coded keyword hack (replaced by a ranked list from the data); a specialist's change request got a misleading chart-access message.
* **Limits (be honest in a demo):** the scripted model proves the system around the model, not the 3B model's judgement; the semantic layer measures closeness of meaning, not clinical truth; scenarios depend on the seeded data (P1001-P1003, two specialists, one account per role); referral clinical rules are not evaluated against clinician-labelled cases.
* **Improve:** clinician-labelled referral cases, a nightly live-model run with a trend, CI gate on unit + behaviour evaluation per commit.
* **Status:** ✅ framework and gate.

---
# 5. Frontend concepts

Next.js 16 App Router, React 19, Tailwind 4, one page (`app/page.tsx`) that shows the signed-in role's portal. Everything talks to the API through `lib/api.ts`.

## 5.1 Structure and shared pieces
| Piece | What / how | Where | Can go wrong / improve |
|---|---|---|---|
| **API client** | `apiFetch` adds the Bearer token, parses JSON, throws `ApiError(status, message, body)` (joins Nest's message arrays), logs out on 401, supports `AbortSignal`; helpers for multipart upload and authenticated image blobs | `lib/api.ts` | Types in `lib/types.ts` are hand-written copies of backend shapes and can drift ⇒ generate from OpenAPI |
| **Auth** | `AuthContext`: login/logout; token + user in `sessionStorage` (wrapped in try/catch) | `context/AuthContext.tsx`, `components/auth/LoginScreen.tsx` | XSS can read the token ⇒ httpOnly cookies; no "forgot password" |
| **Roles & realtime** | `RoleContext`: effective role (admin may "View as"), Socket.IO connection with the token, in-memory alert list, `useRealtime` hook so portals refresh on events | `context/RoleContext.tsx` | Alerts vanish on refresh ⇒ persisted notifications |
| **Header** | brand, "Services: All N up" pill (admin only, from `/admin/health`), WebSocket status, alerts bell, user + role badge, logout, "View as" segmented control (admin) | `components/layout/HeaderNav.tsx` | |
| **UI helpers** | loading/empty/error/success boxes, safety-findings panel, AI-draft banner, patient picker (first 100 patients, marks closed) | `components/ui/*` | Picker caps at 100 ⇒ typeahead search |
| **Design system** | tokens + base styles in `globals.css`: 17 px root (19 px ≥ 1600 px, 21 px ≥ 2200 px), body 16 px, smallest text ≈ 15 px, AA-contrast muted text, 44 px inputs, visible focus rings, zebra tables, reduced-motion support; fonts Inter + JetBrains Mono | `app/globals.css`, `app/layout.tsx` | The build downloads fonts (needs internet once) |

## 5.2 Portals (one per role)
| Portal | What it does | Backend calls |
|---|---|---|
| **Receptionist** | Registration form with validation; live queue (wait minutes, status); stat cards; print token (browser print); "Notify doctor" (creates a task) | `register-op`, `queue`, `tasks` |
| **ED Triage (nurse)** | Vitals form incl. consciousness, oxygen, SpO2 scale 2; shows NEWS2, breakdown, sepsis screen, suggested ESI — **nothing is computed in the browser**; closed patients disabled | `triage` |
| **Nurse ward** | Ward board sorted by NEWS2; SBAR draft via AI (with "AI draft" banner); voice scribe button is **disabled and labelled not implemented** | `ward`, `ai/documents` |
| **Doctor workbench** | Patient list/search; chart sections (allergies, medications, conditions, vitals, labs, imaging); consultation form; on HTTP 409 shows the safety findings and an override-reason box; visit panel (timeline + allowed transitions); no open visit disables the form | `patients`, `summary`, `vitals`, `labs`, `imaging`, `record-consultation`, `close/reopen` |
| **Radiology** | DICOM upload + impression; per-patient study list; authenticated preview image; lab-result form | `imaging-study`, `patients/:id/imaging`, `imaging/:id/preview`, `lab-result` |
| **Pharmacy** | Queue of prescriptions with safety result; ad-hoc audit form | `pharmacy/queue`, `pharmacy/audit` |
| **Care coordinator** | Prior-authorization letter, discharge instructions with translation language; "AI draft — clinician review required" | `ai/documents` |
| **Admin** | Service health cards, audit log, **Agent observability** (metrics, breaker, drift, runs, waterfall), **Knowledge base** (upload/paste/list/delete/re-index), **Patient management** (search, complete/reopen visit, delete with typed ID) | `admin/*`, `patients/*` |

## 5.3 Chat drawer
Floating "Ask AI" button → 520 px dialog (role=dialog, Escape closes, input focused, labelled input, live log region). Thread history, "New chat", elapsed-seconds counter, **Cancel**, light formatting of answers (paragraphs, bullet lists, bold; no HTML injected), suggested first questions, "Tools used (n)" collapsed with each tool's status, duration, **refusal reason** and arguments, citations, guardrail warnings, copyable trace id. Proposals appear as **approval cards** (`ApprovalCard.tsx`) whose state comes from the server copy of the action and updates by polling (so a typed "yes" updates the card): Awaiting approval → Executing → Done and verified, or Done not verified / Partially completed / Failed / Declined / Expired, with a Proposed→Approved→Executing→Verified progress line, real verification checks and the failure reason. `PendingActionsPanel` shows the same vocabulary in its history.
* **Can go wrong:** no token streaming (the answer appears when complete); the card refreshes every 4 s while open rather than by socket event.

## 5.4 Design system and frontend status
* **Design system (2026-10-09):** enterprise healthcare look: light surfaces, navy brand, neutral text, four status tones (success/warning/danger/info), Inter at a 12/14/16/18/20/24/30 px scale, 8–10 px radius. Tokens in `app/globals.css`; components in `components/ui/kit.tsx` (Button, Card, PageHeader, SectionTitle, StatTile, Badge, Alert, Field/Input/Select/Textarea, TableFrame, Tabs, EmptyState, Spinner, Skeleton, Detail). Every portal has one h1, labelled fields, empty/loading/error states, responsive grids, status always shown as text. `apps/web-app/scripts-check-design.sh` fails if legacy colour classes or gradients reappear.
* **Status:** all portals converted; browser tests `npm run test:ui` (roles + full journey) · 🟡 no i18n, no dark theme, tablet/phone layouts built responsively but only desktop was exercised in the browser tests · ⬜ appointment calendar, user profile/settings, patient timeline view.

---

# 6. Running and operating it

## 6.1 First-time setup
```bash
cp .env.example .env            # set DB_PASSWORD, JWT_SECRET (>=32 chars), SEED_USER_PASSWORD (+ LLM settings, see 2.8)
docker compose up -d postgres   # compose now defines ONLY Postgres+pgvector (HAPI FHIR & Orthanc must be provided separately)
npm install && npm run start:dev                                   # API :3000
cd apps/web-app && cp .env.local.example .env.local && npm install && npm run dev -- -p 3001
# local AI (optional):  ollama pull llama3.2:3b && ollama pull nomic-embed-text && ollama create llama3.2-hospital -f ops/Modelfile.hospital
```
`.env.example` does not yet list the Ollama / proxy variables — copy them from section 2.8. HAPI FHIR and Orthanc: point `FHIR_SERVER_URL` / `ORTHANC_URL` at servers you control.

## 6.2 Commands
| Command | Purpose |
|---|---|
| `npm test` | 572 unit tests |
| `npm run eval:build` | regenerate the per-role scenarios from the oracle (`tests/evaluation/agent/`) |
| `npm run test:agent-eval` | 1,565 behaviour scenarios on the production path + critical-failure gate + semantic layer (needs the DB and the embedding model) |
| `npm run test:eval` | scripted evaluation + regression gate (needs the DB; not the LLM) |
| `npm run test:eval:live` | also asks the real configured model 10 questions |
| `npm run test:eval:baseline` | accept current results as the baseline |
| `npx ts-node tests/evaluation/retrieval/retrieval-check.ts` | index/retrieval/delete-cleanup check (creates and deletes test patients) |
| `npm run build` / `npm run start:prod` | production build / run `dist/main` |
| `npm run seed:fhir` | ⚠ pushes 50 random patients (`patient-bulk-*`) **to FHIR only** (not Postgres) — creates inconsistency; avoid or fix |
| `cd apps/web-app && npm run build && npx next start -p 3001` | production web build |

## 6.3 Backup and reset
* Backup: `docker exec hospital_postgres pg_dump -U hospital_user hospital_db > backup.sql` (the vector table can be excluded with `--exclude-table=document_embeddings`; it is rebuilt at start).
* Data lives in the Docker volume `pgdata` (survives container restarts/recreation; destroyed by `docker compose down -v`).
* Rebuild the AI index: admin → *Re-index everything*, or restart the API.

## 6.4 Troubleshooting
| Symptom | Likely cause | Fix |
|---|---|---|
| Chat says the AI is unavailable (503) | no model configured (provider key/proxy token missing) or circuit breaker open | set `LLM_PROVIDER` + key (or start Ollama); wait 30 s if the breaker is open |
| Answers take 10–100 s | local CPU model | use a cloud/proxy model or a GPU; lookups/lists/counts are instant anyway |
| First question after a pause is slow | Ollama unloaded the model | warm-up service normally prevents it; check Ollama is running |
| `fhirSynced: false` | FHIR server unreachable | start it; restart API or press *Re-index everything* |
| Scan preview 404 | image missing in the PACS | re-upload the DICOM (same file ⇒ same instance id) |
| Login "429 Too Many Requests" | 10 logins/min limit | wait a minute |
| API won't start | invalid/missing env value | read the error list printed at start |
| Web build fails offline | fonts are downloaded at build | build once with internet |
| Agent can't find a new policy | embedding model changed or indexing failed | *Re-index everything* |
| Port 5432 busy | another Postgres | this project uses `DB_PORT=5433` |

---

# 7. Security and privacy review

**In place:** signed tokens with expiry · bcrypt (cost 12) · constant-ish login timing · deny-by-default global guard · role checks on every sensitive route · minimum-necessary views per role · input validation with unknown fields rejected · login/AI/global rate limits · helmet headers · CORS allow-list · WebSocket authentication and role rooms · audit log · masked PHI for the model · PHI-free traces · typed-ID confirmation for deletion · open-visit requirement for clinical writes · no secrets in code (`.env`, validated) · document upload never uses the client filename as a path · DB ports bound to 127.0.0.1.

**Gaps (be honest):** token in `sessionStorage` · no refresh/revocation/MFA/password reset · no encryption at rest or TLS in the dev setup · schema auto-sync · audit log not tamper-proof and unbounded · name masking is dictionary-based and does not cover embeddings sent to a cloud provider · chat history/traces retain PHI with no retention policy · agent write tools use soft confirmation · seeded accounts share one password · FHIR/PACS have no auth in dev and are shared with another project · no dependency/vulnerability scanning in CI · no penetration test · **not a certified medical device and not HIPAA/GDPR-audited**.

---

# 8. Status: done / partial / not built

| Area | Status | Notes |
|---|---|---|
| Login, JWT, roles, throttling | ✅ | no refresh/MFA |
| Patient registration, queue, wait alerts | ✅ | no duplicate detection |
| Triage NEWS2 / sepsis screen | ✅ | ESI is a heuristic |
| Consultation + medication-safety shield | ✅ | small rule set, no dose checks |
| Labs (entry, classification, critical alerts) | 🟡 | no ordering/acknowledgement |
| Imaging upload/preview/delete (DICOM→PACS) | 🟡 | no patient-match check, no viewer |
| FHIR mirror | 🟡 | 3 resource types, one-way, no retry queue |
| Pharmacy | 🟡 | view/audit only; no approve/dispense |
| Appointments & tasks | 🟡 | API + agent only, no UI |
| Visit lifecycle (complete/reopen/cancel) / delete patient | ✅ | no discharge summary / soft delete |
| Real-time events | ✅ | single node, alerts not persisted |
| Audit log | ✅ | not tamper-proof |
| RAG / embeddings / vector store | ✅ | hybrid search, re-ranking missing |
| Admin document upload | ✅ | no OCR/versioning |
| Agent: tools + RBAC | ✅ | soft write-confirmation |
| Agent: retrieve-first, direct answers, grounded mode | ✅ | English regex routing |
| Agent: PHI masking | 🟡 | dictionary-based |
| Agent: guardrails | 🟡 | structural checks only |
| Agent: memory (short-term) | ✅ | not Mastra Memory; no long-term |
| Agent: reliability (timeout/retry/breaker) | ✅ | no provider failover |
| Agent: observability, metrics, drift | ✅ | no external export/alerts |
| Evals + regression baseline | ✅ | dataset small (10 live questions) |
| AI document drafts (SBAR, prior-auth, translation) | 🟡 | drafts; model-quality dependent |
| Streaming answers | ⬜ | |
| Voice scribe, SMS follow-up, insurance submission, billing, bed management, lab ordering, dispensing | ⬜ | UI says "not implemented" where visible |
| Database migrations | ✅ | CI check that entities match migrations still missing |
| CI pipeline | ⬜ | tests run manually |
| Dead code | ✅ removed | The unused `src/ai/mcp`, `src/ai/workflows`, `src/mastra`, `src/app.service.ts`, the tool shims (`lifecycle.tools.ts`, `rag.tools.ts`, `fhir-hapi.tools.ts`, `dicom-fhir.tools.ts`, `notifications/`) and the stale `test/` e2e template were deleted on 2026-10-09 |

---

# 9. What can go wrong (ranked)

| # | Risk | Impact | Mitigation now | Fix |
|---|---|---|---|---|
| 1 | A model gives a confident wrong clinical answer | patient harm / credibility | lookups answered without the model; grounded mode; guardrails; "not clinical advice" wording | stronger model + larger golden eval + human review for advice |
| 2 | Local 3B model is slow and weak | bad demo | direct answers (< 0.1 s), warm-up | cloud/proxy model (`LLM_PROVIDER`), GPU |
| 3 | PHI leaves the machine (cloud model or OpenAI embeddings) | privacy breach | masking; local embeddings by default | BAA-covered provider, real de-identification |
| 4 | Shared FHIR/PACS with another app; 50 stray `patient-bulk-*` patients in FHIR | data mixing | none | dedicated servers; clean the stray patients; fix/remove `seed:fhir` |
| 5 | `synchronize` changes schema automatically | data loss in production | dev only | migrations |
| 6 | Token theft (sessionStorage) | account takeover | 8 h expiry | httpOnly cookies, MFA |
| 7 | An agent *write* tool is called wrongly | wrong record | role limits, validation, audit, closed-session block | confirm-before-execute step |
| 8 | Wrong-patient scan upload | clinical error | none | DICOM patient-match check |
| 9 | Scale: single node, `findMentioned` loads all patients per chat, in-memory caches/breaker | slow/inconsistent at volume | fine for tens/hundreds of patients | indexed search, Redis, horizontal scaling |
| 10 | Stale/dead code and tests mislead new developers | confusion | TODO headers + this guide | delete dead files, fix e2e template |

---

# 10. Roadmap: how to improve it

> The detailed, phased plan for turning the assistant into an action-taking agent (approvals, task plans, proactive behaviour, task evals) is in AGENT_UPGRADE_PLAN (removed); the workflow-first backlog (visits, specialists, referrals, notifications, evals) is in [`AGENT_PENDING_WORK.md`](AGENT_PENDING_WORK.md).

**Before presenting (hours):** add a working cloud/proxy model and re-run `npm run test:eval:live` · rehearse the demo in section 11.3 · give FHIR/PACS dedicated servers or remove the stray FHIR patients · copy the Ollama/proxy variables into `.env.example`.

**Next 2 weeks:** DICOM patient-match safety check · confirm-before-execute for agent writes · migrations · pharmacist approve/reject · FHIR outbox + retry and more resources (Condition, AllergyIntolerance, MedicationRequest, Encounter) · appointment calendar UI · delete dead code and fix the e2e test · CI (lint, unit, scripted eval on every commit; live eval nightly) · streaming chat responses.

**Next 1–3 months:** Mastra Memory (working memory + semantic recall) alongside the privacy rules · hybrid search + re-ranking · OpenTelemetry export and drift alerts · larger eval set from real questions + LLM-as-judge · SSO/MFA/refresh tokens · retention and purge policies (chat/traces/audit) · drug knowledge base integration · lab ordering and result acknowledgement · discharge workflow · multi-instance deployment (Redis for sockets/breaker/cache) · encryption at rest and TLS · security review/pen-test.

**Later:** mobile/tablet UI · multilingual routing and answers · voice scribe (speech-to-text with clinician review) · payer integrations · analytics dashboards.

---

# 11. How to explain and present it

## 11.1 The two-minute pitch
"This is a hospital operating system with an AI assistant built in. A patient walks in; the receptionist registers them; the nurse scores their vitals with the standard early-warning score; the doctor sees the chart and prescribes — and an automatic safety check blocks dangerous prescriptions. Every piece of information is saved once, copied to healthcare-standard systems, and instantly searchable by the assistant. The assistant never guesses: facts come straight from the database, the model only helps with language, patient names are masked before the model sees them, and every question is traced and measured. We test the assistant automatically — 136 checks, and on the real model it picks the right data and gives a grounded answer 10 out of 10 times on our test questions. It's a proof of concept, not yet a clinical product, and I can show you exactly what's finished and what isn't."

## 11.2 Key messages (and what NOT to claim)
Say: *source-of-truth database · role-based views · deterministic safety and scoring · retrieval-first AI · privacy by masking · measured by evals and traces.*
Do **not** say: "clinically validated", "HIPAA compliant", "the AI is always right", "FHIR holds the whole record", "it scales to a hospital today", "Mastra provides the memory" (our memory is custom).

## 11.3 Demo script (≈ 10 minutes, all steps verified)
1. **Receptionist** → register a patient → success message ("FHIR sync: yes; RAG indexed: yes") → appears in the live queue.
2. **Nurse** → triage that patient: HR 125, BP 92, SpO2 91 %, temp 39.2, RR 26, confused → NEWS2 15 HIGH, sepsis screen positive, ESI 2 → alert appears for doctors.
3. **Doctor** → open **Eleanor Vance (P1001)** → prescribe *Amoxicillin 500mg* → **blocked: penicillin allergy** → show the findings, then stop (resubmitting with a reason would add another consultation to that chart). *Demo-data note:* P1001 already contains one Amoxicillin consultation saved with an override during development testing, so her chart shows a medication-safety alert — useful to show, but reset it (or use a new patient) if you want a clean story.
4. **Chat (as doctor)**, in this order:
   * `List all patients in the hospital.` → instant, exact list.
   * `i need total details about somisetty` → instant full chart; then `what medicines did the doctor give him?` → resolves "him".
   * `What should we do when a patient gets a rash after a drug?` → policy answer with the file and section cited (model-written: ≈ 10 s locally).
   * `Assess triage: HR 125, systolic BP 92, SpO2 91% on air, temp 39.2, RR 26, confused.` → NEWS2 15, computed by the calculator.
   * `How many patients are waiting?` → exact counts, instant.
5. **Admin** → upload a short policy PDF → ask the chat a question about it → show the citation → open **Agent observability** (a run's waterfall) and the **audit log** → close, then delete a test patient (typed ID).
6. Close with: the eval numbers and the "not built" list (section 8).

## 11.4 Mapping to the five areas Raj asked for
| Area | Where it is in the project | Proof to show |
|---|---|---|
| Agents + tool calling | `src/ai/tools/*`, `AiService` agent mode | tool badges with durations in the chat; 15 role-filtered tools |
| Memory and context | `src/ai/memory/*` | follow-up "him"; thread list; summary badge |
| Evals + regression tracking | `tests/evaluation/*`, `baseline.json` | `npm run test:eval` output (136/136 baseline), live 10/10 |
| Reliability, failure handling, drift | `src/ai/reliability/*`, `observability/metrics.ts` | breaker/retry/timeout checks; drift box in Admin |
| Logging, observability, tracing | `RunRecorder`, `agent_runs`, JSON log lines, Admin → Agent observability | run waterfall, trace id on every answer |

## 11.5 Likely questions and honest answers
| Question | Answer |
|---|---|
| Can doctors rely on it? | No — it is a proof of concept. Lookups come straight from the data; reasoning answers need clinician review. |
| Where does patient data go? | With the current setup (local Ollama) nothing leaves the machine. With a cloud model the *masked* chat text leaves; with OpenAI embeddings raw record text would — so embeddings stay local. |
| What if the AI is wrong? | Exact facts are not generated by the model; guardrails flag unrecognised ids/failed tools; every answer has a trace; evals catch regressions before release. |
| How do you know quality doesn't degrade? | Automated regression baseline + drift metrics; both compare against recorded history. |
| Why Mastra? | It provides the Agent and tool-calling layer. Memory, routing, masking and observability are our own code around it (and moving to Mastra Memory is on the roadmap). |
| What does it cost to run? | Local: hardware only. Cloud: per-token — traces record token usage so cost can be reported. |
| Is it ready for production? | No: migrations, MFA/cookies, encryption, retention, scaling and a clinical validation study come first (sections 7–10). |

---
# 12. File-by-file reference

Line counts are approximate. **Status** uses the legend at the top. "Spec" = unit tests live next to the file.

## 12.1 Repository root
| File | Purpose | Status |
|---|---|---|
| `README.md` | short entry point (points here) | ✅ |
| `PROJECT_GUIDE.md` | this document | ✅ |
| `package.json` | dependencies, scripts, Jest config (transforms ESM-only Nest packages) | ✅ |
| `tsconfig.json`, `tsconfig.build.json` | TypeScript settings; the build config excludes specs, `tests` and `apps` | ✅ |
| `nest-cli.json`, `eslint.config.mjs`, `.prettierrc` | Nest/ESLint/Prettier config (ESLint is strict; ≈ 190 "unsafe any" findings remain) | 🟡 |
| `docker-compose.yml` | **only** PostgreSQL + pgvector (volume `pgdata`, bound to 127.0.0.1) | ✅ (HAPI/Orthanc removed from compose) |
| `.env`, `.env.example` | settings (`.env.example` lacks the Ollama/proxy keys) | 🟡 |
| `knowledge/*.md` (6) | built-in policies: appointment, discharge, discharge-and-followup, emergency-escalation, emergency-triage-protocol, medication-administration | ✅ seed content |
| `ops/Modelfile.hospital` | builds the tuned local model `llama3.2-hospital` | ✅ |
| `dist/` | build output | generated |

## 12.2 Backend — `src/`
### Entry, config, shared
| File | Purpose |
|---|---|
| `main.ts` | bootstrap: helmet, CORS, global ValidationPipe, shutdown hooks ✅ |
| `app.module.ts` | wires modules; global ThrottlerGuard + JwtAuthGuard + AuditInterceptor; TypeORM config ✅ |
| `app.controller.ts` (+spec) | `GET /health` (public liveness + DB ping) ✅ |
| `config/app.config.ts` | zod-validated environment; `corsOrigins()` ✅ |
| `common/ids.ts` | collision-resistant id generator `newId(prefix,len)` ✅ |

### Security and auth
| File | Purpose |
|---|---|
| `security/jwt-auth.guard.ts` (+spec) | verifies JWT, attaches user, enforces `@Roles`, honours `@Public` ✅ |
| `security/roles.decorator.ts` | `UserRole` list, `@Roles`, `@Public` ✅ |
| `security/auth-user.ts` | `AuthUser` class + `@CurrentUser()` decorator ✅ |
| `security/audit.interceptor.ts` | writes `audit_logs` rows ✅ |
| `auth/auth.controller.ts` | `POST /auth/login` (public, 10/min), `GET /auth/me` ✅ |
| `auth/auth.service.ts` | bcrypt login, token issue ✅ |
| `auth/auth.module.ts` | global `JwtModule` (secret + expiry from config) ✅ |

### Data layer
| File | Purpose |
|---|---|
| `database/data.module.ts` | registers entities + data services ✅ |
| `database/entities/*.ts` (13 files + `index.ts`) | one entity per table (section 2.3) ✅ |
| `database/seed.service.ts` | first-start seed: 7 users, 3 demo patients, 2 labs ✅ |
| `database/seeds/seed-fhir-patients.ts` | `npm run seed:fhir`: 50 random patients to FHIR only ⚠ creates FHIR/DB mismatch 🟡 |

### Hospital workflows
| File | Purpose |
|---|---|
| `hospital/hospital.controller.ts` | all `/hospital/*` routes with roles (patients, summary, close/reopen/delete, labs, meds, vitals, imaging, preview, appointments, tasks, lifecycle, pharmacy) ✅ |
| `hospital/hospital-lifecycle.service.ts` | the workflows: register, consult, lab, imaging, triage, ward, queue, alerts, pharmacy, close/reopen/delete; DB-first then best-effort side effects ✅ |
| `hospital/hospital.service.ts` | data access for the person: patients (create, cascade delete incl. visits, duplicate candidates, `findMentioned`), labs, appointments, tasks ✅ |
| `hospital/visits/*` | visit statuses, transition table, `VisitsService` (single status writer), summaries ✅ |
| `hospital/patient-directory.service.ts`, `overview.service.ts`, `patient-matching.ts`, `patient-identity.ts`, `mention-matching.ts`, `post-commit.service.ts` | patient list with current visit, hospital numbers, duplicate matching, DOB/age rules, name mentions, best-effort post-commit work ✅ |
| `database/migrations/*`, `database/typeorm.config.ts`, `database/data-source.ts` | migrations and the shared DB options ✅ |
| `hospital/clinical-records.service.ts` | consultations (transactional save), vitals, imaging studies ✅ |
| `hospital/patient-summary.service.ts` | role-aware 360° chart incl. safety alerts ✅ |
| `hospital/news2.service.ts` (+spec) | NEWS2, SIRS, ESI suggestion ✅ |
| `hospital/medication-safety.service.ts` (+spec) | allergy / duplicate / interaction / renal screening ✅ |
| `hospital/lab-rules.ts` (+spec) | unit-aware critical limits and range classification ✅ |
| `hospital/queue-monitor.service.ts` | 60 s job → one wait alert per patient ✅ |
| `hospital/referrals/*` (`referral-rules.service.ts`, `referral-verifier.service.ts`, `referral-recommendation.service.ts`, `referral.types.ts`) | deterministic referral rule evaluation, evidence verifier against current visit facts, structured recommendation with proposal ✅ |
| `hospital/dto/hospital.dto.ts` | validated request shapes ✅ |
| `hospital/hospital.types.ts` | shared types ✅ |
| `hospital/hospital.module.ts` | module wiring ✅ |
| `events/hospital-events.gateway.ts`, `events.module.ts` | authenticated role-scoped Socket.IO ✅ |
| `admin/admin.controller.ts`, `admin.module.ts` | health, audit, agent metrics/runs, knowledge CRUD, re-index (ADMIN only) ✅ |

### AI — `src/ai/`
| File | Purpose | Status |
|---|---|---|
| `ai.controller.ts`, `ai.dto.ts`, `ai.module.ts` | `/ai/chat`, `/ai/documents`, `/ai/threads*`; validation; wiring | ✅ |
| `ai.service.ts` | the orchestrator (section 4.1) + document generation | ✅ (split later) |
| `agent.ts` | agent factories + the two instruction sets (agent / grounded) | ✅ |
| `guardrails.ts` (+spec) | raw-tool-call detection, list completeness/rendering, answer checks | ✅/🟡 |
| `llm/model.ts`, `llm-provider.ts`, `warmup.service.ts` | providers, injectable model seam, Ollama keep-warm | ✅ |
| `routing/intent.ts`, `chart-view.ts`, `vitals-parser.ts`, `overview-view.ts` (+specs) | deterministic routing and direct answers | ✅ |
| `tools/tool-registry.ts` | `ClinicalTool` type, `ToolTrace`, role sets | ✅ |
| `context/agent-context.ts`, `agent-context.builder.ts`, `tool-policy.ts` | per-request AgentContext, state-aware tool visibility, patient binding for writes ✅ |
| `tools/clinical-tools.factory.ts` | per-request, role-filtered, masked, traced Mastra tools; `runDirect` | ✅ |
| `tools/patient/patient.tools.ts` | patient lookup tools (`searchPatients`, `getPatientSummary`) | ✅ |
| `tools/clinical/clinical-read.tools.ts` | new clinical read tools (`getCurrentVisit`, `getVitalsHistory`, `getLabs`, `getMedications`, `getAllergies`, `searchClinicalGuidelines`) | ✅ |
| `tools/clinical/clinical-assess.tools.ts` | assessment tools (`searchClinicalRecords`, `verifyMedicationSafety`, `assessTriage`) | ✅ |
| `tools/specialist/specialist.tools.ts` | specialist tools (`findSpecialists`, `getSpecialistAvailability`) | ✅ |
| `tools/scheduling/scheduling.tools.ts` | scheduling/workflow tools (`getAppointmentsAndTasks`, `bookAppointment`, `createStaffTask`, `registerOpPatient`, `recordDoctorConsultation`, `checkUnconsultedAlerts`, `getHospitalOverview`) | ✅ |
| `tools/actions/propose.tools.ts` | proposal tools (`proposeReferral`, `proposeFollowUp`, `proposeTask`, `proposeNotification`, `proposeLabOrder`) - return proposals only, zero DB writes | ✅ |
| `tools/interop/interop.tools.ts` | interop tools (`queryLiveHapiFhirPatients`, `queryLiveOrthancStudies`, `searchHospitalPolicies`) | ✅ |
| `tools/hospital.tools.ts` | shared tool helpers used by the domain tool folders | ✅ |
| `tools/loose-schema.ts`, `validate-dto.ts` | lenient argument parsing; REST-equivalent validation for tool writes | ✅ |
| `memory/conversation-memory.service.ts`, `summarizer.service.ts`, `context-window.ts` (+spec) | threads, summary, window selection | ✅ |
| `reliability/resilience.ts` (+spec), `llm-runner.ts` | timeout/retry/circuit breaker | ✅ |
| `observability/run-recorder.ts`, `agent-runs.service.ts`, `metrics.ts` (+spec) | traces, persistence, metrics, drift | ✅ |
| `security/phi-session.ts` (+spec), `phi-anonymizer.service.ts` | masking | ✅/🟡 |
| `rag/embedding.provider.ts` | OpenAI / Ollama / hash embeddings, factory | ✅ |
| `rag/pgvector-rag.service.ts` | `VectorStore` port + pgvector implementation | ✅ |
| `rag/vector-rag.service.ts` | chunking, ingest, search, query-embedding cache | ✅ |
| `rag/record-documents.ts` | rows → searchable documents | ✅ |
| `rag/fhir-dicom-ingest.service.ts` | boot/admin re-index + FHIR re-sync | ✅ |
| `rag/knowledge-documents.service.ts`, `knowledge.module.ts` | uploaded policy documents | ✅ |
| `dicom/dicom.service.ts`, `dicom/orthanc.client.ts` | DICOM parsing; PACS client | ✅/🟡 (TODO notes inside) |
| `fhir/fhir.service.ts`, `fhir/fhir-hapi.client.ts`, `fhir/interop.module.ts` | FHIR mapping and client | 🟡 (TODO notes inside) |

## 12.3 Frontend — `apps/web-app/src/`
| File | Purpose |
|---|---|
| `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | providers + fonts; role → portal switch; design tokens |
| `lib/api.ts`, `lib/types.ts` | API client; shared types (hand-written) |
| `context/AuthContext.tsx`, `context/RoleContext.tsx` | session; role/"view as"; sockets; alerts |
| `components/auth/LoginScreen.tsx` | sign-in card |
| `components/layout/HeaderNav.tsx` | header, status pills, alerts, "View as" |
| `components/ui/common.tsx`, `ui/PatientPicker.tsx` | shared UI helpers |
| `components/portals/ReceptionistPortal.tsx` | registration + queue |
| `components/portals/EdTriagePortal.tsx` | triage |
| `components/portals/NurseWardPortal.tsx` | ward board + SBAR |
| `components/portals/DoctorWorkbenchPortal.tsx` | chart + consultation + close/reopen |
| `components/portals/RadiologyPortal.tsx` | DICOM + labs |
| `components/portals/PharmacyPortal.tsx` | prescription queue + audit |
| `components/portals/CareCoordinatorPortal.tsx` | AI paperwork drafts |
| `components/portals/AdminPortal.tsx` | admin page (health, audit) hosting the panels below |
| `components/portals/AgentObservability.tsx` | metrics, drift, runs, waterfall |
| `components/portals/KnowledgeBasePanel.tsx` | document upload/list/delete/re-index |
| `components/portals/PatientManagementPanel.tsx` | visit complete/reopen/cancel, history, delete patients |
| `lib/visits.ts`, `components/ui/VisitPanel.tsx` | single source of visit labels/colours; timeline + transition buttons |
| `components/ai/MastraChatDrawer.tsx` | the chat assistant UI |

## 12.4 Tests and tooling
| File | Purpose |
|---|---|
| `src/**/*.spec.ts` (14 suites, 87 tests) | unit tests of pure logic: NEWS2, drug safety, lab rules, routing, vitals parser, chart rendering, guardrails, PHI masking, resilience, metrics/drift, JWT guard, context window, health controller |
| `tests/evaluation/system/evaluator.ts` | evaluation + regression gate (section 4.14) |
| `tests/evaluation/system/patient_queries.json` | 10 golden questions with the expected tool/data and answer pattern |
| `tests/evaluation/system/baseline.json` | accepted reference results (136/136) |
| `tests/evaluation/results/` | timestamped run outputs |
| `tests/evaluation/retrieval/retrieval-check.ts` | index sync, retrieval, delete-cleanup, shared-image safety (24 checks) |

---

# 13. Glossary
| Term | Meaning |
|---|---|
| **RBAC** | role-based access control: what each role may do |
| **JWT** | signed login token carried on every request |
| **NEWS2** | National Early Warning Score 2 (UK) — adds points for abnormal vitals; ≥ 5 or any red value ⇒ escalate |
| **SIRS** | systemic inflammatory response syndrome screen (sepsis warning signs) |
| **ESI** | Emergency Severity Index, urgency level 1 (most urgent) – 5 |
| **SBAR** | Situation-Background-Assessment-Recommendation handoff format |
| **eGFR / CKD-EPI** | kidney-function estimate / the formula used |
| **FHIR** | HL7 standard for exchanging health records (HAPI = an open-source FHIR server) |
| **DICOM / PACS / Orthanc** | imaging file standard / image archive / the open-source PACS used |
| **pgvector / HNSW** | PostgreSQL vector extension / its fast approximate-search index |
| **Embedding** | a list of numbers representing the meaning of text; similar meaning ⇒ nearby numbers |
| **RAG** | retrieval-augmented generation: look up data first, then write the answer from it |
| **Grounded** | the model may only use the supplied data |
| **Tool calling** | the model asks the system to run a defined function |
| **PHI** | protected health information (names, phone, ids…) |
| **Circuit breaker** | stops calling a failing service for a while |
| **Drift** | the agent's behaviour changing over time (model update, data change, provider issue) |
| **Trace / span** | the recorded timeline of one request / one step in it |
| **Baseline (eval)** | the recorded "good" result set new runs are compared against |

---

# 14. How this guide was verified
* Written on 2026-10-07 from the repository as it stood, with these facts re-checked against the live system: all 14 database tables exist; routes and role lists were extracted from the controller decorators; the 15 tools and their roles from the tool files; environment variable names from `process.env`/config reads; unit tests `87 passed (14 suites)`; evaluation baseline `136/136` (live model section 10/10 + 10/10); retrieval check `24/24`; FHIR/PACS contents compared with PostgreSQL for a real patient (FHIR holds Patient + 1 Observation + 1 ImagingStudy, not medications/diagnoses/vitals); FHIR server contains 50 `patient-bulk-*` patients from `npm run seed:fhir`; file inventory generated from the file system.
* Items marked 🟡/⬜ are limitations observed in the code, not guesses. If something here disagrees with the code, the code is right — fix this file.
* Not independently verified in this session: behaviour with a cloud model (no working API key/proxy token was available), multi-user load, and any security penetration testing.
