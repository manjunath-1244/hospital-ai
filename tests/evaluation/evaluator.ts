import 'dotenv/config';
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { AppModule } from '../../src/app.module';
import { ClinicalToolsFactory } from '../../src/ai/tools/clinical-tools.factory';
import { ToolTrace } from '../../src/ai/tools/tool-registry';
import { PhiAnonymizerService } from '../../src/ai/security/phi-anonymizer.service';
import { VectorRagService } from '../../src/ai/rag/vector-rag.service';
import { AiService } from '../../src/ai/ai.service';
import { createHospitalAgent } from '../../src/ai/agent';
import { LlmProvider } from '../../src/ai/llm/llm-provider';
import { LlmRunner } from '../../src/ai/reliability/llm-runner';
import { CircuitBreaker } from '../../src/ai/reliability/resilience';
import { AgentRunsService } from '../../src/ai/observability/agent-runs.service';
import { ConversationMemoryService } from '../../src/ai/memory/conversation-memory.service';
import { KnowledgeDocumentsService } from '../../src/ai/rag/knowledge-documents.service';
import type { AuthUser } from '../../src/security/auth-user';

/**
 * Evaluation + regression tracking against the REAL application graph (Postgres, pgvector, tools, PHI shield, memory,
 * resilience, tracing). Every check is recorded; results are compared with tests/evaluation/baseline.json and the
 * process exits non-zero if any check that passed in the baseline now fails (a regression).
 *
 *   npm run test:eval                    run + compare with baseline
 *   npm run test:eval -- --update-baseline   accept the current results as the new baseline
 *   EVAL_LIVE_LLM=1 npm run test:eval    also run the real configured LLM (tool choice + answer accuracy)
 */
const DIR = __dirname;
const doctor: AuthUser = {
  userId: 'USR-EVAL-DOCTOR',
  userName: 'Dr. Sarah Jenkins',
  role: 'DOCTOR',
};
const other: AuthUser = {
  userId: 'USR-EVAL-OTHER',
  userName: 'Other Doctor',
  role: 'DOCTOR',
};
const receptionist: AuthUser = {
  userId: 'USR-EVAL-REC',
  userName: 'Alex',
  role: 'RECEPTIONIST',
};
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Step = {
  tool?: { name: string; args: unknown };
  text?: string;
  throw?: any;
  delayMs?: number;
};
type Handler = (promptText: string, call: number) => Step;

/** A scripted model: `handler` decides each reply from the prompt it receives. Supports generate and stream. */
function scripted(handler: Handler) {
  let call = 0;
  const reply = async (prompt: any) => {
    const text = JSON.stringify(prompt);
    const step = handler(text, call++);
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
    if (step.throw) throw step.throw;
    return step;
  };
  const model: any = new MockLanguageModelV3({
    doGenerate: async (opts: any) => {
      const s = await reply(opts.prompt);
      return {
        content: s.tool
          ? [
              {
                type: 'tool-call',
                toolCallId: `c${call}`,
                toolName: s.tool.name,
                input: JSON.stringify(s.tool.args),
              },
            ]
          : [{ type: 'text', text: s.text ?? '' }],
        finishReason: {
          unified: s.tool ? 'tool-calls' : 'stop',
          raw: undefined,
        },
        usage,
        warnings: [],
      } as any;
    },
    doStream: async (opts: any) => {
      const s = await reply(opts.prompt);
      const chunks: any[] = [{ type: 'stream-start', warnings: [] }];
      if (s.tool)
        chunks.push({
          type: 'tool-call',
          toolCallId: `c${call}`,
          toolName: s.tool.name,
          input: JSON.stringify(s.tool.args),
        });
      else
        chunks.push(
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: s.text ?? '' },
          { type: 'text-end', id: 't' },
        );
      chunks.push({
        type: 'finish',
        finishReason: {
          unified: s.tool ? 'tool-calls' : 'stop',
          raw: undefined,
        },
        usage,
      });
      return { stream: simulateReadableStream({ chunks }) } as any;
    },
  });
  return {
    model,
    calls: () => call,
    prompts: () =>
      [...(model.doGenerateCalls ?? []), ...(model.doStreamCalls ?? [])].map(
        (c: any) => JSON.stringify(c.prompt),
      ),
  };
}

const toolThenText =
  (name: string, args: unknown, text: string): Handler =>
  (prompt) =>
    /"type":"tool-result"|tool-result/.test(prompt)
      ? { text }
      : { tool: { name, args } };

interface CheckResult {
  id: string;
  phase: string;
  name: string;
  pass: boolean;
  ms: number;
  detail?: string;
}
const results: CheckResult[] = [];
let phase = '';
let phaseStart = Date.now();
function check(name: string, pass: boolean, detail = '') {
  const id = `${phase}::${name}`;
  results.push({
    id,
    phase,
    name,
    pass,
    ms: Date.now() - phaseStart,
    detail: pass ? undefined : detail.slice(0, 300),
  });
  console.log(
    `  ${pass ? '✅' : '❌'} ${name}${pass ? '' : `  → ${detail.slice(0, 200)}`}`,
  );
  phaseStart = Date.now();
}
const section = (name: string) => {
  phase = name;
  phaseStart = Date.now();
  console.log(`\n▶ ${name}`);
};

async function main() {
  const updateBaseline = process.argv.includes('--update-baseline');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const tools = app.get(ClinicalToolsFactory);
  const phi = app.get(PhiAnonymizerService);
  const rag = app.get(VectorRagService);
  const ai = app.get(AiService);
  const llm = app.get(LlmProvider);
  const runner = app.get(LlmRunner) as any;
  const runs = app.get(AgentRunsService);
  const memory = app.get(ConversationMemoryService);
  const ds = app.get(DataSource);
  const cases = JSON.parse(
    fs.readFileSync(path.join(DIR, 'patient_queries.json'), 'utf-8'),
  );

  // An admin-uploaded document must be usable by the agent immediately (exercises the real upload + index path).
  const knowledge = app.get(KnowledgeDocumentsService);
  const evalDoc = await knowledge.add({
    title: 'EVAL ward codes',
    filename: 'eval-ward-codes.md',
    content:
      '# Ward emergency codes\n\n## Missing patient\nThe ward emergency code word for a missing patient is "BLUE HERON". The charge nurse announces it and security locks the exits.',
    uploadedBy: 'USR-EVAL',
  });

  const saved = { ...process.env };
  const resetBreaker = () => (runner.breaker = new CircuitBreaker());
  process.env.AI_RETRY_BASE_MS = '5';

  // ---------------------------------------------------------------- 1. tools + 2. agent loop
  for (const tc of cases) {
    section(`tools ${tc.id}: ${tc.tool}`);
    const session = await phi.createSession();
    const out: any = await (
      tools.build({ user: doctor, phi: session, trace: new ToolTrace() })[
        tc.tool
      ] as any
    ).execute(tc.args, {});
    check('tool returns success', out?.success === true, JSON.stringify(out));
    check(
      `output contains "${tc.expectContains}"`,
      JSON.stringify(out).includes(tc.expectContains),
    );
    check(
      'no raw patient name/phone leaves the tool layer',
      !/Eleanor Vance|Marcus Brody|555-01/.test(JSON.stringify(out)),
    );

    const t2 = new ToolTrace();
    const s2 = await phi.createSession();
    const sm = scripted(toolThenText(tc.tool, tc.args, 'Done.'));
    const agent = createHospitalAgent({
      model: sm.model,
      role: doctor.role,
      tools: tools.build({ user: doctor, phi: s2, trace: t2 }),
    });
    const res = await agent.generate(
      [
        {
          role: 'user',
          content: s2.mask(`${tc.query} (patient Eleanor Vance)`),
        },
      ] as any,
      { maxSteps: 4 } as any,
    );
    check(
      'agent loop executed the tool',
      t2.calls.some((c) => c.name === tc.tool && c.success),
      JSON.stringify(t2.calls),
    );
    check('agent returned final text', !!res.text);
    check(
      'model never saw the raw patient name',
      !sm.prompts().join('').includes('Eleanor Vance'),
    );
  }

  // ---------------------------------------------------------------- 3. RBAC
  section('rbac');
  const recNames = tools.toolNamesFor(receptionist);
  check(
    'receptionist cannot search clinical records',
    !recNames.includes('searchClinicalRecords'),
  );
  check(
    'receptionist cannot use recordDoctorConsultation',
    !recNames.includes('recordDoctorConsultation'),
  );
  check(
    'receptionist can register patients',
    recNames.includes('registerOpPatient'),
  );
  check(
    'doctor cannot register patients',
    !tools.toolNamesFor(doctor).includes('registerOpPatient'),
  );
  llm.useModel(
    scripted(
      toolThenText('searchClinicalRecords', { query: 'penicillin' }, 'ok'),
    ).model,
  );
  let denied: any;
  try {
    denied = await ai.chat(receptionist, { message: 'show labs for P1001' });
  } catch (e) {
    denied = { thrown: true };
  }
  check(
    'model cannot execute a tool its role does not have',
    !(denied?.toolCalls ?? []).some(
      (c: any) => c.name === 'searchClinicalRecords' && c.success,
    ),
    JSON.stringify(denied).slice(0, 200),
  );

  const recSet = tools.build({
    user: receptionist,
    phi: await phi.createSession(),
    trace: new ToolTrace(),
  });
  const recSummary: any = await (recSet.getPatientSummary as any).execute(
    { patientId: 'P1001' },
    {},
  );
  check(
    'receptionist summary has demographics only (no allergies/labs/medications)',
    recSummary.success === true &&
      !('allergies' in recSummary) &&
      !('labs' in recSummary) &&
      !('currentMedications' in recSummary),
    Object.keys(recSummary).join(),
  );

  // ---------------------------------------------------------------- 4. retrieval
  section('retrieval');
  const hits = await rag.searchPolicies(
    'penicillin allergy alternative antibiotics',
    3,
  );
  check(
    'penicillin query surfaces the discharge policy',
    hits.some((h) => /discharge/.test(h.source)),
    JSON.stringify(hits.map((h) => h.source)),
  );
  const rec = await rag.searchPatientRecords(
    'allergies medications',
    'P1001',
    3,
  );
  check(
    'patient-record search is scoped to that patient',
    rec.length > 0 && rec.every((h) => h.patientId === 'P1001'),
  );

  // ---------------------------------------------------------------- 5. memory & context
  section('memory');
  resetBreaker();
  const m1 = scripted((p, i) => ({
    text: i === 0 ? 'P1001 HbA1c is 7.8%.' : 'Follow-up answer.',
  }));
  llm.useModel(m1.model);
  const a = await ai.chat(doctor, { message: 'Let us discuss P1001 now' });
  check(
    'first turn succeeds and creates a thread',
    a.success === true && !!(a as any).threadId,
    JSON.stringify(a).slice(0, 200),
  );
  const threadId = (a as any).threadId as string;
  const b = await ai.chat(doctor, {
    message: 'And what were we looking at again?',
    threadId,
  });
  check('second turn reuses the thread', (b as any).threadId === threadId);
  const seen2 = m1.prompts().slice(-1)[0] ?? '';
  check(
    'model receives the earlier turns from server-side memory',
    seen2.includes('Let us discuss P1001 now') &&
      seen2.includes('HbA1c is 7.8'),
  );
  check(
    'patient in focus carried into the agent instructions',
    /currently about patient P1001/.test(seen2),
  );
  const thread = await memory.getThread(doctor, threadId);
  check(
    '4 messages persisted (2 turns)',
    thread.messages.length === 4,
    String(thread.messages.length),
  );
  let foreign = false;
  try {
    await memory.getThread(other, threadId);
  } catch {
    foreign = true;
  }
  check("another user cannot read this user's thread", foreign);
  let foreignChat = false;
  try {
    await ai.chat(other, { message: 'hi', threadId });
  } catch {
    foreignChat = true;
  }
  check("another user cannot continue this user's thread", foreignChat);

  section('memory: summarisation');
  process.env.AI_CONTEXT_TOKENS = '80';
  const m2 = scripted((p) =>
    /Summarise the conversation/.test(p)
      ? { text: 'SUMMARY: discussed P1001 diabetes labs.' }
      : { text: 'Noted.' },
  );
  llm.useModel(m2.model);
  const long = 'x'.repeat(260);
  let tid: string | undefined;
  let last: any;
  for (let i = 0; i < 4; i++) {
    last = await ai.chat(doctor, {
      message: `Turn ${i} ${long}`,
      threadId: tid,
    });
    tid = last.threadId;
  }
  check(
    'older turns were summarised once the budget was exceeded',
    last.memory?.summarized === true,
    JSON.stringify(last.memory),
  );
  check(
    'summary is injected into later prompts',
    m2.prompts().slice(-1)[0]?.includes('SUMMARY: discussed P1001'),
  );
  check(
    'context stays bounded (not all turns resent)',
    (last.memory?.messagesInContext ?? 99) < 7,
    JSON.stringify(last.memory),
  );
  process.env.AI_CONTEXT_TOKENS = saved.AI_CONTEXT_TOKENS ?? '';
  if (!saved.AI_CONTEXT_TOKENS) delete process.env.AI_CONTEXT_TOKENS;

  // ---------------------------------------------------------------- 6. reliability
  section('reliability');
  resetBreaker();
  let n = 0;
  llm.useModel(
    scripted(() =>
      n++ < 2
        ? {
            throw: Object.assign(new Error('Service unavailable'), {
              statusCode: 503,
            }),
          }
        : { text: 'Recovered.' },
    ).model,
  );
  const r1: any = await ai.chat(doctor, { message: 'retry test' });
  check(
    'transient 503s are retried and the request succeeds',
    r1.success === true && r1.response === 'Recovered.',
    JSON.stringify(r1).slice(0, 200),
  );
  const run1 = await runs.get(r1.traceId);
  check(
    'retries are recorded on the trace',
    run1.retries === 2,
    String(run1.retries),
  );

  resetBreaker();
  let calls401 = 0;
  llm.useModel(
    scripted(() => {
      calls401++;
      return {
        throw: Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
      };
    }).model,
  );
  const r2: any = await ai.chat(doctor, { message: 'bad key test' });
  check(
    'non-transient errors are NOT retried',
    calls401 === 1,
    `calls=${calls401}`,
  );
  check(
    'user gets a clean error plus trace id (no stack/internal detail)',
    r2.success === false &&
      !!r2.traceId &&
      !/Unauthorized|stack/i.test(r2.error),
  );
  check(
    'failed runs are recorded as ERROR',
    (await runs.get(r2.traceId)).status === 'ERROR',
  );

  resetBreaker();
  process.env.AI_TIMEOUT_MS = '150';
  process.env.AI_MAX_RETRIES = '0';
  llm.useModel(scripted(() => ({ text: 'too late', delayMs: 600 })).model);
  const r3: any = await ai.chat(doctor, { message: 'timeout test' });
  check(
    'a hung model call is cut off by the timeout',
    r3.success === false &&
      /timed out/i.test((await runs.get(r3.traceId)).error ?? ''),
  );
  process.env.AI_TIMEOUT_MS = saved.AI_TIMEOUT_MS ?? '';
  if (!saved.AI_TIMEOUT_MS) delete process.env.AI_TIMEOUT_MS;

  resetBreaker();
  const down = scripted(() => ({
    throw: Object.assign(new Error('Service unavailable'), { statusCode: 503 }),
  }));
  llm.useModel(down.model);
  for (let i = 0; i < 5; i++) await ai.chat(doctor, { message: `outage ${i}` });
  const before = down.calls();
  let status = 0;
  try {
    await ai.chat(doctor, { message: 'after outage' });
  } catch (e: any) {
    status = e.getStatus?.() ?? 0;
  }
  check(
    'circuit breaker opens after repeated provider failures',
    status === 503 && runner.breakerSnapshot().state === 'OPEN',
    `status=${status} ${JSON.stringify(runner.breakerSnapshot())}`,
  );
  check(
    'open breaker fails fast without calling the model',
    down.calls() === before,
  );
  process.env.AI_MAX_RETRIES = saved.AI_MAX_RETRIES ?? '';
  if (!saved.AI_MAX_RETRIES) delete process.env.AI_MAX_RETRIES;
  resetBreaker();

  section('reliability: failure handling in answers');
  llm.useModel(
    scripted(
      toolThenText(
        'getPatientSummary',
        { patientId: 'P9999' },
        'No data found.',
      ),
    ).model,
  );
  const f1: any = await ai.chat(doctor, {
    message: 'fetch that record again please',
  });
  check(
    'a failing tool is reported, not hidden',
    f1.toolCalls?.[0]?.success === false && f1.guardrailStatus === 'WARNING',
    JSON.stringify(f1).slice(0, 250),
  );
  const nf = scripted(() => ({ text: 'There is no such patient.' }));
  llm.useModel(nf.model);
  const unknownPatient: any = await ai.chat(doctor, {
    message: 'labs for P9999',
  });
  check(
    'a non-existent patient id is answered "not found" directly, without calling the model',
    /No patient with id P9999 exists/.test(unknownPatient.response) &&
      nf.calls() === 0,
    JSON.stringify({ r: unknownPatient.response, calls: nf.calls() }),
  );

  llm.useModel(
    scripted(() => ({ text: 'Patient P1002 has a creatinine of 9.9.' })).model,
  );
  const f2: any = await ai.chat(doctor, { message: 'tell me something' });
  check(
    'guardrail flags a patient id the agent never retrieved',
    f2.guardrailStatus === 'WARNING' &&
      f2.guardrailNotes.some((x: string) => /P1002/.test(x)),
    JSON.stringify(f2).slice(0, 250),
  );
  llm.useModel(scripted(() => ({ text: 'P1001 HbA1c is 7.8%.' })).model);
  const f3: any = await ai.chat(doctor, {
    message: 'tell me about P1001 please',
  });
  check(
    'a grounded answer passes the guardrail',
    f3.guardrailStatus === 'VERIFIED_SAFE',
    JSON.stringify(f3).slice(0, 250),
  );

  // Retrieve-first: the answer must not depend on the model choosing the right tool.
  const noTool = scripted(() => ({ text: 'Answer without tools.' }));
  llm.useModel(noTool.model);
  const pr1: any = await ai.chat(doctor, {
    message: 'Is P1001 allergic to penicillin?',
  });
  const seenByModel = noTool.prompts().join('');
  check(
    'a patient id in the question triggers a server-side chart fetch',
    pr1.toolCalls.some(
      (c: any) => c.name === 'getPatientSummary' && c.auto === true,
    ),
    JSON.stringify(pr1.toolCalls),
  );
  check(
    'an allergy question is answered directly from the chart (no model needed)',
    /Penicillin/.test(pr1.response) && noTool.calls() === 0,
    String(pr1.response).slice(0, 200),
  );

  const reasoning = scripted(() => ({ text: 'ok' }));
  llm.useModel(reasoning.model);
  await ai.chat(doctor, {
    message: 'Is P1001 allergic to penicillin, and is that a concern?',
  });
  const sent = reasoning.prompts().join('');
  check(
    'for reasoning questions the model is handed the chart (allergies present) with no raw patient name or phone',
    /Penicillin/.test(sent) && !/Eleanor Vance|555-01/.test(sent),
    sent.slice(0, 200),
  );

  const noTool2 = scripted(() => ({ text: 'ok' }));
  llm.useModel(noTool2.model);
  const pr2: any = await ai.chat(doctor, {
    message: "What are Eleanor's lab results?",
  });
  check(
    'a first name that matches exactly one patient resolves to that chart',
    pr2.toolCalls.some(
      (c: any) =>
        c.name === 'getPatientSummary' && c.args.patientId === 'P1001',
    ) && /HbA1c/.test(pr2.response),
    JSON.stringify(pr2.toolCalls),
  );
  const noTool3 = scripted(() => ({ text: 'ok' }));
  llm.useModel(noTool3.model);
  const pr3: any = await ai.chat(receptionist, {
    message: 'Is P1001 allergic to penicillin?',
  });
  check(
    'preloaded charts respect the role (receptionist gets no allergies)',
    !/Penicillin/.test(noTool3.prompts().join('')) &&
      pr3.toolCalls.some((c: any) => c.auto),
  );
  const noTool4 = scripted(() => ({ text: 'ok' }));
  llm.useModel(noTool4.model);
  const pr4: any = await ai.chat(doctor, {
    message: 'How many patients are waiting?',
  });
  check(
    'no patient mentioned means no chart is fetched',
    !pr4.toolCalls.some((c: any) => c.auto && c.name === 'getPatientSummary'),
  );
  check(
    'a counting question fetches the hospital overview server-side (grounded mode)',
    pr4.toolCalls.some(
      (c: any) => c.auto && c.name === 'getHospitalOverview',
    ) && pr4.mode === 'grounded',
    JSON.stringify(pr4.toolCalls.map((c: any) => c.name)),
  );

  // Plain-language questions must not be mistaken for patient names, and policy questions need no keyword.
  const g1 = scripted(() => ({
    text: 'Per policy: suspend the drug and report the reaction.',
  }));
  llm.useModel(g1.model);
  const rash: any = await ai.chat(doctor, {
    message: 'What should we do when a patient gets a rash after a drug?',
  });
  check(
    'the word "patient" never resolves to a patient called "Test Patient"',
    !rash.toolCalls.some((c: any) => c.name === 'getPatientSummary'),
    JSON.stringify(rash.toolCalls.map((c: any) => [c.name, c.args])),
  );
  check(
    'a plain-language policy question retrieves the right policy server-side',
    rash.mode === 'grounded' &&
      rash.citations.some((c: any) =>
        /medication-administration/.test(c.file),
      ) &&
      /Adverse Drug Reaction/.test(g1.prompts().join('')),
    JSON.stringify({ mode: rash.mode, cites: rash.citations }),
  );
  const g2 = scripted(() => ({ text: 'hi!' }));
  llm.useModel(g2.model);
  const hi: any = await ai.chat(doctor, { message: 'hello how are you' });
  check(
    'small talk gets no irrelevant data attached',
    hi.toolCalls.length === 0 && hi.mode === 'agent',
    JSON.stringify(hi.toolCalls),
  );
  llm.useModel(
    scripted(() => ({ text: '{id: "P1001", name: "x"} garbled' })).model,
  );
  const lst: any = await ai.chat(doctor, {
    message: 'List all patients in the hospital.',
  });
  check(
    'a list question is answered directly from system data (model not needed), cleanly formatted',
    /^Patients in the system \(\d+\):/.test(lst.response) &&
      !/[{}]/.test(lst.response) &&
      /P1001/.test(lst.response) &&
      /P1003/.test(lst.response),
    String(lst.response).slice(0, 160),
  );

  // The conversation from the field: details about a patient, then follow-ups that only say "him/her".
  const lk = scripted(() => ({
    text: 'model should not be needed for lookups',
  }));
  llm.useModel(lk.model);
  const d1: any = await ai.chat(doctor, {
    message: 'i need total details about Eleanor, what is her condition',
  });
  check(
    'full-details request is answered from the database, completely, without the model',
    lk.calls() === 0 &&
      /Penicillin/.test(d1.response) &&
      /HbA1c/.test(d1.response) &&
      /Lisinopril/.test(d1.response) &&
      /Hypertension/.test(d1.response),
    String(d1.response).slice(0, 300),
  );
  const d2: any = await ai.chat(doctor, {
    message: 'what was the medications the doctor gave to her',
    threadId: d1.threadId,
  });
  check(
    'a follow-up with only a pronoun resolves to the patient in focus and lists their medications',
    lk.calls() === 0 &&
      /Lisinopril/.test(d2.response) &&
      /Metformin/.test(d2.response) &&
      !/Policy|Protocol/i.test(d2.response),
    String(d2.response).slice(0, 300),
  );
  const d3: any = await ai.chat(doctor, {
    message: 'what medicines gave to him by doctor',
  });
  check(
    'a pronoun with no patient in focus asks which patient instead of guessing',
    lk.calls() === 0 && /Which patient/.test(d3.response),
    String(d3.response).slice(0, 200),
  );
  const d4: any = await ai.chat(doctor, {
    message: 'is her HbA1c a concern?',
    threadId: d1.threadId,
  });
  check(
    'a reasoning question about the patient in focus goes to the model, with the chart as context',
    lk.calls() === 1 &&
      d4.mode === 'grounded' &&
      d4.toolCalls.some((c: any) => c.auto && c.name === 'getPatientSummary'),
    JSON.stringify({ calls: lk.calls(), mode: d4.mode }),
  );

  // Vital-sign numbers must reach the NEWS2 calculator (tool agent), never be answered from policy text.
  const tri = scripted(() => ({ text: 'ok' }));
  llm.useModel(tri.model);
  const tr: any = await ai.chat(doctor, {
    message:
      'Assess triage: HR 125, systolic BP 92, SpO2 91% on air, temp 39.2, RR 26, confused.',
  });
  check(
    'vital-sign numbers in a message are scored by the NEWS2 calculator (exact, no model, no policy text)',
    tri.calls() === 0 &&
      /NEWS2 score: 15 \(HIGH\)/.test(tr.response) &&
      /Suggested ESI level: 2/.test(tr.response) &&
      tr.toolCalls.some((c: any) => c.name === 'assessTriage' && c.auto),
    String(tr.response).slice(0, 200),
  );
  const tri2 = scripted(() => ({ text: 'Please give all five vitals.' }));
  llm.useModel(tri2.model);
  const trPartial: any = await ai.chat(doctor, {
    message: 'Assess triage: HR 125 and BP 92',
  });
  check(
    'with vitals missing, no score is invented (falls back to the model/tool agent)',
    !/NEWS2 score:/.test(trPartial.response) && tri2.calls() >= 1,
    String(trPartial.response).slice(0, 160),
  );

  // Counts come straight from the database: exact numbers, no model call.
  const ov = scripted(() => ({ text: 'model should not run' }));
  llm.useModel(ov.model);
  const ovr: any = await ai.chat(doctor, {
    message: 'How many patients are waiting for a doctor?',
  });
  const dbWaiting = Number(
    (
      await ds.query(
        `select count(*)::int as n from patients where "consultationStatus"='WAITING'`,
      )
    )[0].n,
  );
  check(
    'a counting question is answered from the database without the model, with the exact number',
    ov.calls() === 0 &&
      new RegExp(`Waiting for a doctor: ${dbWaiting}\\b`).test(ovr.response),
    String(ovr.response).slice(0, 200),
  );

  // A list answer must be complete even when a small model drops items.
  llm.useModel(
    scripted(
      toolThenText('searchPatients', {}, 'Patients: Eleanor Vance (P1001).'),
    ).model,
  );
  const l1: any = await ai.chat(doctor, { message: 'list all patients' });
  const allPatients: any = await (
    tools.build({
      user: doctor,
      phi: await phi.createSession(),
      trace: new ToolTrace(),
    }).searchPatients as any
  ).execute({}, {});
  const missingIds = (allPatients.patients ?? [])
    .filter((p: any) => p.id !== 'P1001')
    .map((p: any) => p.id);
  check(
    'a list answer that omits patients is completed from system data',
    missingIds.length > 0 &&
      missingIds.every((id: string) => l1.response.includes(id)),
    String(l1.response).slice(0, 200),
  );

  // Raw tool-call JSON printed as an answer is retried once, then never shown to the user.
  let rawCalls = 0;
  llm.useModel(
    scripted(() =>
      ++rawCalls === 1
        ? {
            text: '{"name":"getPatientSummary","parameters":{"patientId":"P1001"}}',
          }
        : { text: 'P1001 is Eleanor Vance, HbA1c 7.8%.' },
    ).model,
  );
  const w1: any = await ai.chat(doctor, { message: 'raw call then fix' });
  check(
    'a raw tool-call answer is retried and recovers',
    w1.success && /HbA1c/.test(w1.response),
    String(w1.response),
  );
  llm.useModel(
    scripted(() => ({
      text: '{"name":"getPatientSummary","parameters":{"patientId":"P1001"}}',
    })).model,
  );
  const w2: any = await ai.chat(doctor, { message: 'always raw' });
  check(
    'persistent raw tool-call output is replaced by a safe message',
    !/"name"\s*:/.test(w2.response) && w2.guardrailStatus === 'WARNING',
    String(w2.response),
  );

  // ---------------------------------------------------------------- 7. observability
  section('observability');
  const run = await runs.get(f3.traceId);
  const types = new Set(run.steps.map((s) => s.type));
  check(
    'trace has memory, llm and tool spans',
    ['memory', 'llm', 'tool'].every((t) => types.has(t as any)),
    [...types].join(),
  );
  check(
    'tool span has name, duration and success',
    run.steps.some(
      (s) =>
        s.type === 'tool' &&
        s.name === 'getPatientSummary' &&
        s.durationMs >= 0 &&
        s.success,
    ),
  );
  check(
    'trace stores token usage',
    (run.usage?.totalTokens ?? 0) > 0 || (run.usage?.inputTokens ?? 0) > 0,
    JSON.stringify(run.usage),
  );
  check(
    'persisted trace contains no raw patient name',
    !JSON.stringify(run.steps).includes('Eleanor Vance'),
  );
  const m = await runs.metrics(24);
  check(
    'metrics aggregate recorded runs',
    m.window.runs > 5 && m.window.errorRate > 0 && m.window.topTools.length > 0,
    JSON.stringify(m.window).slice(0, 200),
  );

  // ---------------------------------------------------------------- 8. live LLM (optional)
  let live:
    | { total: number; toolOk: number; answerOk: number; model: string }
    | undefined;
  if (process.env.EVAL_LIVE_LLM === '1') {
    section('live LLM');
    llm.useModel(undefined);
    resetBreaker();
    live = { total: 0, toolOk: 0, answerOk: 0, model: llm.label() };
    for (const tc of cases) {
      const r: any = await ai.chat(doctor, { message: tc.query });
      const toolOk =
        !!r.success &&
        r.toolCalls.some(
          (c: any) =>
            (tc.acceptTools ?? [tc.tool]).includes(c.name) && c.success,
        );
      const answerOk =
        !!r.success && new RegExp(tc.answerMustMatch, 'i').test(r.response);
      live.total++;
      if (toolOk) live.toolOk++;
      if (answerOk) live.answerOk++;
      check(
        `[${tc.id}] chose ${tc.tool}`,
        toolOk,
        JSON.stringify(r).slice(0, 220),
      );
      check(
        `[${tc.id}] answer is grounded (/${tc.answerMustMatch}/)`,
        answerOk,
        String(r.response ?? r.error).slice(0, 220),
      );
    }
  }

  // ---------------------------------------------------------------- cleanup (eval data must not pollute real metrics)
  llm.useModel(undefined);
  await knowledge.remove(evalDoc.id);
  await ds.query(`DELETE FROM agent_runs WHERE "userId" LIKE 'USR-EVAL%'`);
  await ds.query(
    `DELETE FROM chat_messages WHERE "threadId" IN (SELECT id FROM chat_threads WHERE "userId" LIKE 'USR-EVAL%')`,
  );
  await ds.query(`DELETE FROM chat_threads WHERE "userId" LIKE 'USR-EVAL%'`);

  // ---------------------------------------------------------------- report + regression gate
  const passed = results.filter((r) => r.pass).length;
  const modelLabel = live?.model ?? 'scripted';
  const report = {
    meta: {
      date: new Date().toISOString(),
      mode: live ? 'live+scripted' : 'scripted',
      model: modelLabel,
    },
    summary: { passed, total: results.length },
    live,
    checks: results,
  };
  fs.mkdirSync(path.join(DIR, 'results'), { recursive: true });
  fs.writeFileSync(
    path.join(DIR, 'results', 'latest.json'),
    JSON.stringify(report, null, 2),
  );
  fs.writeFileSync(
    path.join(DIR, 'results', `${report.meta.date.replace(/[:.]/g, '-')}.json`),
    JSON.stringify(report, null, 2),
  );

  const basePath = path.join(DIR, 'baseline.json');
  let regressions: string[] = [];
  let improvements = 0;
  if (fs.existsSync(basePath) && !updateBaseline) {
    const base = JSON.parse(fs.readFileSync(basePath, 'utf-8'));
    const now = new Map(results.map((r) => [r.id, r]));
    for (const b of base.checks as CheckResult[]) {
      if (b.phase === 'live LLM' && !live) continue; // live checks only gate live runs
      if (b.pass && !now.get(b.id)?.pass)
        regressions.push(`${b.id}${now.has(b.id) ? '' : ' (missing)'}`);
    }
    improvements = results.filter(
      (r) =>
        r.pass &&
        base.checks.find((b: CheckResult) => b.id === r.id && !b.pass),
    ).length;
    console.log(
      `\nBaseline: ${base.summary.passed}/${base.summary.total} (${base.meta.date.slice(0, 10)}, ${base.meta.model})`,
    );
  } else if (updateBaseline) {
    fs.writeFileSync(basePath, JSON.stringify(report, null, 2));
    console.log('\nBaseline updated.');
  } else {
    console.log(
      '\nNo baseline yet: run with --update-baseline to record this run as the reference.',
    );
  }

  console.log(
    `\n${'-'.repeat(60)}\n📊 ${passed}/${results.length} checks passed${live ? ` | live ${live.model}: tool choice ${live.toolOk}/${live.total}, grounded answers ${live.answerOk}/${live.total}` : ''}`,
  );
  if (improvements)
    console.log(`📈 ${improvements} check(s) improved vs baseline`);
  if (regressions.length)
    console.log(
      `🔻 REGRESSIONS vs baseline:\n   - ${regressions.join('\n   - ')}`,
    );
  console.log('-'.repeat(60));

  await app.close();
  const failedNow = results.filter(
    (r) => !r.pass && r.phase !== 'live LLM',
  ).length;
  process.exit(regressions.length || failedNow ? 1 : 0);
}

main().catch((err) => {
  console.error('Evaluation error:', err);
  process.exit(1);
});
