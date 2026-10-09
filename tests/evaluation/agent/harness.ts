/**
 * Behaviour-defined agent evaluation. Every scenario states what the agent MUST do (or must not do) for a message, and is
 * judged by deterministic checks: no model grading, no answer-text guessing beyond explicit required/forbidden strings.
 *
 * It runs the PRODUCTION code path (AiService.chat -> QueryPlan router -> context/tools/guardrails/memory/traces) against
 * the dev database with the seeded patients P1001-P1003 (open visits) and the seeded specialists. Only the LLM is replaced:
 *   model "none"      any model call is a failure (the answer must come from routing + data alone)
 *   model {script}    a fixed sequence of tool calls / texts, so tool selection, authorization, validation, proposals and
 *                     claim reconciliation are exercised for real without depending on a 3B model's mood
 *
 * Critical failures (any one fails the run, exit code 1): WRONG_PATIENT, FABRICATED_CLINICAL_FACT, UNAUTHORIZED_PHI_ACCESS,
 * UNAUTHORIZED_ACTION, ACTION_WITHOUT_CONFIRMATION, FALSE_ACTION_SUCCESS, UNSAFE_AUTONOMY, DATA_WRITTEN_UNEXPECTEDLY.
 *
 *   npm run test:agent-eval                  all scenarios
 *   npm run test:agent-eval -- --only ACT    only ids starting with ACT
 *   npm run test:agent-eval -- --probe       print what the agent does for each scenario message (authoring aid)
 */
import 'dotenv/config';
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { MockLanguageModelV3 } from 'ai/test';
import { AppModule } from '../../../src/app.module';
import { AiService } from '../../../src/ai/ai.service';
import { LlmProvider } from '../../../src/ai/llm/llm-provider';
import { EmbeddingProvider } from '../../../src/ai/rag/embedding.provider';
import { SemanticScorer, SEMANTIC_DEFAULT_MIN } from './semantic';
import { ActionExecutorService } from '../../../src/ai/actions/action-executor.service';
import type { AuthUser } from '../../../src/security/auth-user';

export type Critical =
  | 'WRONG_PATIENT'
  | 'FABRICATED_CLINICAL_FACT'
  | 'UNAUTHORIZED_PHI_ACCESS'
  | 'UNAUTHORIZED_ACTION'
  | 'ACTION_WITHOUT_CONFIRMATION'
  | 'FALSE_ACTION_SUCCESS'
  | 'UNSAFE_AUTONOMY'
  | 'DATA_WRITTEN_UNEXPECTEDLY';

type Step = { tool?: { name: string; args: unknown }; text?: string };
interface TurnExpect {
  handler?: string; // route.handler starts with
  intent?: string;
  entity?: string;
  decision?: string; // HANDLE | CLARIFY | AGENT
  contains?: string[]; // all (case-insensitive)
  containsAny?: string[]; // at least one
  notContains?: string[];
  tools?: string[]; // each must have been called
  noTools?: string[]; // none may have been called
  anyTool?: boolean; // some tool must / must not run
  proposals?: number; // exact count of proposal cards
  proposalType?: string;
  proposalStatus?: string;
  modelCalls?: number;
  guardrail?: string;
  toolFailed?: string; // this tool was called and reported success=false
  toolsOk?: string[]; // each of these was called AND succeeded
  citesAny?: string[]; // a citation must name one of these files
}
interface Turn {
  say: string;
  as?: string;
  newThread?: boolean; // start a fresh conversation for this turn
  sqlBefore?: string; // run before the turn; {thread} and {id0}.. are replaced
  expect?: TurnExpect;
}
interface After {
  approve?: boolean | number; // approve the proposal of this turn (0-based proposal index; true = first)
  as?: string;
  note?: string;
  expectStatus?: string;
  expectThrows?: string; // regex on the error message
  run?: string; // a statement to execute (test set-up)
  sql?: string; // must return rows[0].n === equals
  equals?: number;
}
interface Scenario {
  id: string;
  category: string;
  role: string;
  turns: Turn[];
  model?: 'none' | { script: Step[] };
  noWrites?: boolean; // no domain table may change (default true unless approve is used)
  after?: After[];
  critical?: Critical; // the kind of critical failure a failure of this scenario represents
  tags?: { stage?: string; tool?: string; behaviour?: string }; // coverage bookkeeping (workflow stage, agent tool, behaviour)
  reference?: string; // what a correct final answer says, in plain words (semantic layer: embedding similarity)
  semanticMin?: number; // similarity threshold for this scenario (default 0.6)
  why?: string;
}

const USERS: Record<string, AuthUser> = {
  DOCTOR: { userId: 'USR-EVAL-DOC', userName: 'Dr. Eval', role: 'DOCTOR' },
  DOCTOR2: { userId: 'USR-EVAL-DOC2', userName: 'Dr. Other', role: 'DOCTOR' },
  NURSE: { userId: 'USR-EVAL-NURSE', userName: 'Nurse Eval', role: 'NURSE' },
  RECEPTIONIST: { userId: 'USR-EVAL-REC', userName: 'Reception Eval', role: 'RECEPTIONIST' },
  ADMIN: { userId: 'USR-EVAL-ADMIN', userName: 'Admin Eval', role: 'ADMIN' },
  PHARMACIST: { userId: 'USR-EVAL-PHARM', userName: 'Pharmacist Eval', role: 'PHARMACIST' },
  RADIOLOGIST: { userId: 'USR-EVAL-RAD', userName: 'Radiologist Eval', role: 'RADIOLOGIST' },
  CARE_COORDINATOR: { userId: 'USR-EVAL-CC', userName: 'Coordinator Eval', role: 'CARE_COORDINATOR' },
  SPECIALIST: { userId: 'USR-EVAL-SPEC', userName: 'Specialist Eval', role: 'SPECIALIST' },
};

const WRITE_TABLES = [
  'appointments',
  'staff_tasks',
  'lab_orders',
  'consultation_requests',
  'consultations',
  'patients',
  'follow_up_plans',
  'notifications',
  'patient_notices',
  'visits',
];

function modelFor(s: Scenario, counter: { calls: number }) {
  const steps = s.model && s.model !== 'none' ? [...s.model.script] : [];
  const next = (): Step => {
    counter.calls++;
    if (s.model === 'none' || !s.model)
      throw new Error('MODEL_CALLED_UNEXPECTEDLY');
    return steps.shift() ?? { text: 'Done.' };
  };
  const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
  const content = (st: Step) =>
    st.tool
      ? [{ type: 'tool-call', toolCallId: `c${counter.calls}`, toolName: st.tool.name, input: JSON.stringify(st.tool.args) }]
      : [{ type: 'text', text: st.text ?? '' }];
  const finish = (st: Step) => ({ unified: st.tool ? 'tool-calls' : 'stop', raw: undefined });
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const st = next();
      return { content: content(st), finishReason: finish(st), usage, warnings: [] } as any;
    },
    doStream: async () => {
      const st = next();
      const chunks: any[] = [{ type: 'stream-start', warnings: [] }];
      if (st.tool)
        chunks.push({ type: 'tool-call', toolCallId: `c${counter.calls}`, toolName: st.tool.name, input: JSON.stringify(st.tool.args) });
      else
        chunks.push({ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: st.text ?? '' }, { type: 'text-end', id: 't' });
      chunks.push({ type: 'finish', finishReason: finish(st), usage });
      return {
        stream: new ReadableStream({
          start(c) {
            for (const ch of chunks) c.enqueue(ch);
            c.close();
          },
        }),
      } as any;
    },
  });
}

async function main() {
  process.env.ROUTE_L2 = 'off';
  const realError = console.error;
  console.error = (...a: unknown[]) => {
    if (/MODEL_CALLED_UNEXPECTEDLY|Error in agent stream/.test(String(a[0]) + JSON.stringify(a[1] ?? ''))) return;
    realError(...a);
  };
  const probe = process.argv.includes('--probe');
  const noSemantic = process.argv.includes('--no-semantic');
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ai = app.get(AiService);
  const llm = app.get(LlmProvider);
  const ds = app.get(DataSource);
  const executor = app.get(ActionExecutorService);

  const scenarioFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scenarioFiles(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : []));
  const roleFilter = process.argv.includes('--role') ? process.argv[process.argv.indexOf('--role') + 1].toUpperCase() : '';
  let scenarios: Scenario[] = scenarioFiles(path.join(__dirname, 'scenarios')).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  if (roleFilter) scenarios = scenarios.filter((s) => s.role === roleFilter);
  if (only) scenarios = scenarios.filter((s) => s.id.startsWith(only));
  const ids = new Set<string>();
  for (const s of scenarios) {
    if (ids.has(s.id)) throw new Error(`duplicate scenario id ${s.id}`);
    ids.add(s.id);
  }

  const counts = async () => {
    const out: Record<string, number> = {};
    for (const t of WRITE_TABLES) out[t] = (await ds.query(`select count(*)::int n from ${t}`))[0].n;
    return out;
  };
  const createdActions: string[] = [];

  type Outcome = { id: string; category: string; role: string; tags?: Scenario['tags']; pass: boolean; critical?: Critical; reasons: string[]; ms: number; answer: string; reference?: string; semanticMin?: number; semantic?: number };
  const outcomes: Outcome[] = [];

  for (const s of scenarios) {
    const t0 = Date.now();
    const reasons: string[] = [];
    const counter = { calls: 0 };
    llm.useModel(modelFor(s, counter) as any);
    const before = await counts();
    const user = USERS[s.role];
    if (!user) throw new Error(`${s.id}: unknown role ${s.role}`);
    let threadId: string | undefined;
    const proposalsByTurn: any[][] = [];
    let lastAnswer = '';
    const wantsApproval = (s.after ?? []).some((a) => a.approve !== undefined);

    try {
      for (let i = 0; i < s.turns.length; i++) {
        const turn = s.turns[i];
        const u = USERS[turn.as ?? s.role];
        const callsBefore = counter.calls;
        const flat = proposalsByTurn.flat();
        const fill = (t: string) =>
          t
            .replace(/\{thread\}/g, threadId ?? '')
            .replace(/\{id(\d)\}/g, (_m, d) => flat[Number(d)]?.id ?? 'ACTMISSING0');
        if (turn.sqlBefore) await ds.query(fill(turn.sqlBefore));
        if (turn.newThread) threadId = undefined;
        const res: any = await ai.chat(u, { message: fill(turn.say), threadId });
        threadId = res.threadId ?? threadId;
        const proposals: any[] = res.proposals ?? [];
        proposalsByTurn.push(proposals);
        for (const p of proposals) if (p.id) createdActions.push(p.id);
        const text: string = String(res.response ?? res.error ?? '');
        const low = text.toLowerCase();
        const tools: string[] = (res.toolCalls ?? []).map((c: any) => c.name);
        const e = turn.expect ?? {};
        const tag = `turn ${i + 1} "${turn.say.slice(0, 50)}"`;
        if (probe)
          console.log(
            `${s.id} t${i + 1} [${u.role}] "${turn.say}"\n   handler=${res.route?.handler} intent=${res.route?.intent}/${res.route?.entity} decision=${res.route?.decision} conf=${res.route?.confidence} model=${counter.calls - callsBefore} tools=${(res.toolCalls ?? []).map((c: any) => c.name + (c.success === false ? '(FAILED:' + c.error + ')' : '')).join(',') || '-'} proposals=${proposals.map((p: any) => p.type + ':' + p.status).join(',') || '-'}\n   → ${text.replace(/\s+/g, ' ').slice(0, 260)}`,
          );
        if (res.success === false) reasons.push(`${tag}: pipeline error: ${res.error}`);
        if (e.handler && !String(res.route?.handler ?? '').startsWith(e.handler))
          reasons.push(`${tag}: handler ${res.route?.handler} (wanted ${e.handler})`);
        if (e.intent && res.route?.intent !== e.intent) reasons.push(`${tag}: intent ${res.route?.intent} (wanted ${e.intent})`);
        if (e.entity && res.route?.entity !== e.entity) reasons.push(`${tag}: entity ${res.route?.entity} (wanted ${e.entity})`);
        if (e.decision && res.route?.decision !== e.decision) reasons.push(`${tag}: decision ${res.route?.decision} (wanted ${e.decision})`);
        for (const c of e.contains ?? []) if (!low.includes(c.toLowerCase())) reasons.push(`${tag}: answer lacks "${c}" (got: ${text.replace(/\s+/g, ' ').slice(0, 160)})`);
        if (e.containsAny?.length && !e.containsAny.some((c) => low.includes(c.toLowerCase())))
          reasons.push(`${tag}: answer has none of ${JSON.stringify(e.containsAny)}`);
        for (const c of e.notContains ?? []) if (low.includes(c.toLowerCase())) reasons.push(`${tag}: answer must not contain "${c}"`);
        for (const t of e.tools ?? []) if (!tools.includes(t)) reasons.push(`${tag}: tool ${t} was not called (called: ${tools.join(',') || 'none'})`);
        for (const t of e.noTools ?? []) if (tools.includes(t)) reasons.push(`${tag}: tool ${t} must not be called`);
        if (e.anyTool === true && !tools.length) reasons.push(`${tag}: expected a tool call`);
        if (e.anyTool === false && tools.length) reasons.push(`${tag}: no tool may run (ran ${tools.join(',')})`);
        if (e.proposals !== undefined && proposals.length !== e.proposals)
          reasons.push(`${tag}: ${proposals.length} proposal cards (wanted ${e.proposals})`);
        if (e.proposalType && !proposals.some((p: any) => p.type === e.proposalType))
          reasons.push(`${tag}: no ${e.proposalType} proposal (got ${proposals.map((p: any) => p.type).join(',') || 'none'})`);
        if (e.proposalStatus && !proposals.every((p: any) => p.status === e.proposalStatus))
          reasons.push(`${tag}: proposal status ${proposals.map((p: any) => p.status)} (wanted ${e.proposalStatus})`);
        if (e.modelCalls !== undefined && counter.calls - callsBefore !== e.modelCalls)
          reasons.push(`${tag}: ${counter.calls - callsBefore} model calls (wanted ${e.modelCalls})`);
        if (e.guardrail && res.guardrailStatus !== e.guardrail) reasons.push(`${tag}: guardrail ${res.guardrailStatus} (wanted ${e.guardrail})`);
        if (e.citesAny?.length) {
          const cites = JSON.stringify(res.citations ?? []).toLowerCase();
          if (!e.citesAny.some((c) => cites.includes(c.toLowerCase()))) reasons.push(`${tag}: no citation of ${JSON.stringify(e.citesAny)}`);
        }
        for (const t of e.toolsOk ?? []) {
          const c = (res.toolCalls ?? []).find((x: any) => x.name === t);
          if (!c || c.success !== true) reasons.push(`${tag}: ${t} should have been called and succeeded (called: ${tools.join(',') || 'none'})`);
        }
        lastAnswer = text;
        if (e.toolFailed) {
          const c = (res.toolCalls ?? []).find((x: any) => x.name === e.toolFailed);
          if (!c || c.success !== false) reasons.push(`${tag}: ${e.toolFailed} should have reported a failure`);
        }
      }

      for (const a of s.after ?? []) {
        if (a.run) await ds.query(a.run);
        if (a.approve !== undefined) {
          const idx = typeof a.approve === 'number' ? a.approve : 0;
          const flat = proposalsByTurn.flat();
          const prop = flat[idx];
          if (!prop?.id) {
            reasons.push(`after: no proposal #${idx} to approve`);
            continue;
          }
          const approver = USERS[a.as ?? s.role];
          try {
            const done = await executor.approveAndExecute(prop.id, approver, a.note);
            if (a.expectThrows) reasons.push(`after: approval should have been refused (${a.expectThrows})`);
            if (a.expectStatus && done.status !== a.expectStatus) reasons.push(`after: status ${done.status} (wanted ${a.expectStatus})`);
            if (done.status === 'DONE' && !done.verification?.verified) reasons.push('after: DONE without verified read-back');
          } catch (err: any) {
            const m = String(err?.message ?? err);
            if (!a.expectThrows) reasons.push(`after: approval threw: ${m}`);
            else if (!new RegExp(a.expectThrows, 'i').test(m)) reasons.push(`after: refusal "${m}" does not match /${a.expectThrows}/`);
          }
        }
        if (a.sql) {
          const n = (await ds.query(a.sql))[0]?.n;
          if (n !== a.equals) reasons.push(`after: sql gave ${n} (wanted ${a.equals}) :: ${a.sql}`);
        }
      }

      if (!wantsApproval && s.noWrites !== false) {
        const afterC = await counts();
        for (const t of WRITE_TABLES) if (afterC[t] !== before[t]) reasons.push(`DATA WRITTEN: ${t} ${before[t]} -> ${afterC[t]}`);
      }
    } catch (err: any) {
      const m = String(err?.message ?? err);
      reasons.push(m.includes('MODEL_CALLED_UNEXPECTEDLY') ? 'the model was called but this answer must not need it' : `error: ${m}`);
    }

    const pass = reasons.length === 0;
    outcomes.push({ id: s.id, category: s.category, role: s.role, tags: s.tags, pass, critical: pass ? undefined : s.critical, reasons, ms: Date.now() - t0, answer: lastAnswer, reference: s.reference, semanticMin: s.semanticMin });
    if (!probe) process.stdout.write(pass ? '.' : 'F');
  }

  // clean up anything the scenarios created
  if (createdActions.length) {
    const rows = await ds.query(`select id,status,type,result from agent_actions where id = any($1)`, [createdActions]);
    for (const r of rows) {
      if (r.status !== 'DONE') continue;
      const res = r.result ?? {};
      const rid = res.id ?? res.consultationId;
      if (r.type === 'APPOINTMENT' && rid) await ds.query(`delete from appointments where id=$1`, [rid]);
      if (r.type === 'STAFF_TASK' && rid) await ds.query(`delete from staff_tasks where id=$1`, [rid]);
      if (r.type === 'LAB_ORDER' && rid) await ds.query(`delete from lab_orders where id=$1`, [rid]);
    }
    await ds.query(
      `delete from follow_up_plans where id in (select payload->>'planId' from agent_actions where id = any($1) and type = 'FOLLOW_UP')`,
      [createdActions],
    ).catch(() => undefined);
    await ds.query(`delete from notifications where "sourceActionId" = any($1)`, [createdActions]).catch(() => undefined);
    await ds.query(`delete from agent_actions where id = any($1)`, [createdActions]);
  }
  await ds.query(`delete from agent_runs where "userId" like 'USR-EVAL-%'`).catch(() => undefined);
  await ds.query(`delete from chat_threads where "userId" like 'USR-EVAL-%'`).catch(() => undefined);

  const total = outcomes.length;
  const passed = outcomes.filter((o) => o.pass).length;

  // ---- semantic layer: runs AFTER the deterministic checks; flags answers that drift from the reference meaning ----
  const semanticFlags: Outcome[] = [];
  let semanticScored = 0;
  if (!noSemantic) {
    try {
      const sem = new SemanticScorer(app.get(EmbeddingProvider));
      for (const o of outcomes.filter((x) => x.reference && x.answer)) {
        o.semantic = await sem.similarity(o.answer, o.reference!);
        semanticScored++;
        if (o.semantic < (o.semanticMin ?? SEMANTIC_DEFAULT_MIN)) semanticFlags.push(o);
      }
    } catch (err: any) {
      console.log(`\nSemantic layer skipped (embedding model unavailable): ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }
  const byCat: Record<string, { n: number; ok: number }> = {};
  for (const o of outcomes) {
    byCat[o.category] ??= { n: 0, ok: 0 };
    byCat[o.category].n++;
    if (o.pass) byCat[o.category].ok++;
  }
  const crit = outcomes.filter((o) => !o.pass && o.critical);
  console.log(`\n\nAGENT EVALUATION (${total} behaviour scenarios, production path, scripted model)\n`);
  for (const [c, v] of Object.entries(byCat)) console.log(`${c.padEnd(26)} ${v.ok}/${v.n}`);
  console.log(`\nPassed ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)   critical failures: ${crit.length}`);
  if (semanticScored) {
    const mean = outcomes.filter((o) => o.semantic != null).reduce((a, o) => a + (o.semantic ?? 0), 0) / semanticScored;
    console.log(`Semantic: ${semanticScored} answers scored against their reference, mean similarity ${mean.toFixed(3)}, ${semanticFlags.length} flagged for manual review (threshold ${SEMANTIC_DEFAULT_MIN})`);
    for (const o of semanticFlags.slice(0, 40)) console.log(`  ? ${o.id} sim=${o.semantic?.toFixed(2)}  answer: ${o.answer.replace(/\s+/g, ' ').slice(0, 110)}`);
  }
  // coverage: scenarios per role x behaviour and which agent tools / workflow stages each role exercises
  const cov: Record<string, Record<string, number>> = {};
  const toolsSeen = new Set<string>();
  const stagesSeen = new Set<string>();
  for (const o of outcomes) {
    const b = o.tags?.behaviour ?? 'untagged';
    (cov[o.role] ??= {})[b] = ((cov[o.role] ??= {})[b] ?? 0) + 1;
    if (o.tags?.tool) toolsSeen.add(o.tags.tool);
    if (o.tags?.stage) stagesSeen.add(o.tags.stage);
  }
  console.log('\nCoverage (scenarios per role x behaviour):');
  const behaviours = [...new Set(Object.values(cov).flatMap((r) => Object.keys(r)))].sort();
  console.log(['role'.padEnd(18), ...behaviours.map((b) => b.slice(0, 11).padEnd(11)), 'total'].join(' '));
  for (const [r, row] of Object.entries(cov)) console.log([r.padEnd(18), ...behaviours.map((b) => String(row[b] ?? 0).padEnd(11)), Object.values(row).reduce((a, n) => a + n, 0)].join(' '));
  console.log(`Tools exercised (${toolsSeen.size}): ${[...toolsSeen].sort().join(', ')}`);
  console.log(`Workflow stages exercised (${stagesSeen.size}): ${[...stagesSeen].sort().join(', ')}`);
  for (const o of outcomes.filter((x) => !x.pass)) {
    console.log(`\n✗ ${o.id} [${o.category}]${o.critical ? `  CRITICAL ${o.critical}` : ''}`);
    for (const r of o.reasons) console.log(`    - ${r}`);
  }
  fs.mkdirSync(path.join(__dirname, '..', 'results'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, '..', 'results', 'agent-eval-latest.json'),
    JSON.stringify({ at: new Date().toISOString(), total, passed, critical: crit.length, categories: byCat, coverage: cov, semantic: { scored: semanticScored, flagged: semanticFlags.map((o) => ({ id: o.id, similarity: o.semantic, answer: o.answer.slice(0, 300), reference: o.reference })) }, failures: outcomes.filter((o) => !o.pass).map((o) => ({ id: o.id, role: o.role, category: o.category, critical: o.critical, reasons: o.reasons, answer: o.answer.slice(0, 400) })) }, null, 2),
  );
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]);
  process.exit(!probe && (crit.length > 0 || passed < total) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
