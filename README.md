# Hospital AI Platform (PoC)

> **Documentation:** [PROJECT_GUIDE.md](PROJECT_GUIDE.md) (full reference of every concept and file) · [AI_AGENT_CONCEPTS.md](AI_AGENT_CONCEPTS.md) (the AI agent explained from first principles, with real examples, labs and how to present it) · [AGENT_UPGRADE_PLAN.md](AGENT_UPGRADE_PLAN.md) (approval/action design) · [POC_DECISIONS.md](POC_DECISIONS.md) (open questions with recommended answers) · [AGENT_PENDING_WORK.md](AGENT_PENDING_WORK.md) (**the checked backlog to turn the app into a workflow-driven agent: gap analysis, work packages W0–W13, milestones**).
>
> **Full documentation: [PROJECT_GUIDE.md](PROJECT_GUIDE.md)** — what each concept is, why it exists, how it works, where it lives in the code, what can go wrong, how to explain it, what is done / partial / not built, and the roadmap.

NestJS 11 API + Mastra AI agent + Next.js UI. PostgreSQL/pgvector is the single source of truth; HAPI FHIR and Orthanc PACS
are mirrors; a local or cloud LLM answers questions about the data. This is a proof of concept: not a certified medical
device, no formal security/HIPAA audit.

## Run it

```bash
cp .env.example .env     # set DB_PASSWORD, JWT_SECRET (>=32 chars), SEED_USER_PASSWORD, ORTHANC_PASSWORD
docker compose up -d postgres      # compose now defines ONLY Postgres+pgvector (persistent volume `pgdata`, 127.0.0.1)
# HAPI FHIR and Orthanc are NOT in docker-compose.yml any more: provide your own servers and set FHIR_SERVER_URL / ORTHANC_URL.
# Do not share them with another project: patient data would mix with that project's data.
npm install && npm run start:dev                         # API :3000
cd apps/web-app && cp .env.local.example .env.local && npm install && npm run dev -- -p 3001
```

Sign in as `receptionist`, `nurse`, `doctor`, `radiologist`, `pharmacist`, `coordinator`, `admin`, `cardiologist` or `neurologist` (specialists) with `SEED_USER_PASSWORD`.

### Choosing the AI models (`.env`)
| Setting | Options |
|---|---|
| `LLM_PROVIDER` | `openai` (+`OPENAI_API_KEY`), `google`, `groq`, or `ollama` (local, private) |
| `EMBEDDING_PROVIDER` | `openai`, `ollama` (`nomic-embed-text`, semantic, local) or `auto` (OpenAI key present, else keyword-only fallback) |

Local setup used for development: `ollama pull llama3.2:3b nomic-embed-text` and
`ollama create llama3.2-hospital -f ops/Modelfile.hospital` (8k context, low temperature).
**A 3B model on CPU is a development convenience, not a clinical-grade model.** Use a stronger model for real use; the
design below keeps answers correct even with a weak one, but a stronger model reasons better.

## Patient journey = visits
A **patient** is a person (demographics, allergies, conditions). A **visit** is one episode of care and carries the
status: `WAITING_TRIAGE → TRIAGED → IN_CONSULTATION → (UNDER_REVIEW / TREATMENT / FOLLOW_UP) → COMPLETED`, or
`CANCELLED` / `LEFT_WITHOUT_SEEN`. Rules (who may move a visit where, when a reason is required) live in one table,
`src/hospital/visits/visit-transitions.ts`, and only `VisitsService.transition()` changes a status. A patient has at most
one open visit; every clinical record (vitals, labs, imaging, consultation, appointment, task) belongs to a visit.
Reception searches first, warns about possible duplicates, and starts a new visit for a returning patient. Triage moves
the visit to *Triaged* and sets its priority; the first consultation moves it to *In consultation*. "Close/reopen
session" is now *complete/reopen visit*. Full detail: PROJECT_GUIDE sections 1.4, 2.3, 3.4, 3.10, 3.11.

## Database schema
Schema changes are **migrations** (`src/database/migrations`, applied automatically at start unless
`DB_MIGRATIONS_RUN=false`). `synchronize` is off. Commands: `npm run migration:generate -- src/database/migrations/Name`,
`migration:run`, `migration:revert`, `migration:show`.

## How data flows
```
UI ─REST+JWT─► role check + validation ─► workflow ─► 1. commit to PostgreSQL (authoritative)
                                                   └► 2. best effort: FHIR copy · chunk+embed into pgvector · live event
                                                   └► 3. audit-log row
```
Failures in step 2 never lose the record; they are reported (`fhirSynced`, `ragIndexed`) and repaired by the startup
backfill or "Re-index everything" (admin). Deleting a patient removes DB rows (one transaction), search chunks, the FHIR
record and PACS images that no other study uses; the audit log is kept.

## How the chat agent answers (retrieve first, then write)
1. Find the patient: id, name, or "him/her" = the patient earlier in the conversation (server-side memory).
2. The **server** fetches what the question needs through role-checked tools: patient chart, patient list, hospital
   numbers, policy/uploaded-document search (semantic), cross-patient record search.
3. Factual lookups ("details", "medications", "labs", "list patients") are **answered directly from the data**: exact,
   complete, instant, no model. Reasoning questions go to the model, which may only use the retrieved CONTEXT.
   Actions (book, register, prescribe...) and open-ended requests use the full tool agent.
4. Names/phones are masked before the model sees anything and restored after. Guardrails check ids, failed tools,
   dropped list items; every run is traced (steps, timings, tokens) and metered (error/guardrail/latency drift).

Admins upload policies (`.md`, `.txt`, `.pdf`) in the app; they are searchable by the agent immediately.

## Quality gates
```bash
npm test                      # ~120 unit tests (NEWS2, drug safety, lab rules, routing, guardrails, resilience, ...)
npm run test:eval             # 100+ checks on the real app: tools, RBAC, memory, retries/timeouts/breaker, tracing, routing
npx ts-node tests/evaluation/retrieval-check.ts   # new data searchable at once; policy/patient retrieval; delete cleanup
npm run test:workflow          # roles x endpoints matrix (415 combinations) + (visit, specialists and the full referral/approval/follow-up loop) # patient journey end to end against the RUNNING API (creates and deletes its own patients)
npm run test:eval:live        # also asks the REAL configured model 10 questions (tool/data choice + grounded answers)
npm run test:eval:baseline    # accept current results as the regression baseline (compared on every run)
```

## Known limits
- Agent write actions rely on role limits, audit logging and a "confirm first" instruction, not a hard approval step.
- Name masking is dictionary-based: a never-seen name typed for the first time is not recognised. Embedding with OpenAI
  sends record text (including names) to OpenAI; keep embeddings local unless covered by a privacy agreement.
- Data is not encrypted at rest. Tokens live in
  `sessionStorage` (use httpOnly cookies for production).
- Drug-safety and lab rules cover a small curated set, not a drug database.
- Not built: billing/insurance submission, pharmacy dispensing, bed management, lab ordering, SMS follow-up, an
  appointment-booking screen (API and agent can book).
- `npm run seed:fhir` writes 50 random patients to FHIR only (not PostgreSQL); avoid it or fix it (see PROJECT_GUIDE.md).
