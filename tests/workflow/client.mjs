/** Small helpers shared by the workflow scripts (run against a RUNNING API; see package.json `test:workflow`). */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const API = process.env.API_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.SEED_USER_PASSWORD;
const tokens = {};
let failed = 0;

export const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok ? '' : `  → ${detail}`}`);
};
export const failures = () => failed;
export const fail = () => failed++;

// The login endpoint is rate-limited (10/min); the workflow scripts run back to back, so tokens are reused for 5 minutes.
const CACHE = join(tmpdir(), 'hospital-workflow-tokens.json');
const CACHE_MS = 5 * 60_000;
const readCache = () => {
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    return c.api === API && Date.now() - c.at < CACHE_MS ? c : null;
  } catch {
    return null;
  }
};

export async function login(...usernames) {
  if (!PASSWORD) throw new Error('SEED_USER_PASSWORD is not set');
  const cache = readCache();
  for (const u of usernames) {
    if (cache?.tokens[u]) {
      tokens[u] = cache.tokens[u];
      continue;
    }
    const r = await call(null, 'POST', '/auth/login', { username: u, password: PASSWORD });
    tokens[u] = r.body.accessToken;
    if (!tokens[u]) throw new Error(`login failed for ${u}: ${JSON.stringify(r.body)}`);
  }
  try {
    writeFileSync(CACHE, JSON.stringify({ api: API, at: cache?.at ?? Date.now(), tokens: { ...(cache?.tokens ?? {}), ...tokens } }));
  } catch {
    /* the cache is only a convenience */
  }
  return tokens;
}

export async function call(as, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    // a direct answer is instant; anything slower went to the language model, which these scripts must not wait for
    signal: AbortSignal.timeout(path.startsWith("/ai/chat") ? Number(process.env.CHAT_TIMEOUT_MS ?? 25_000) : 60_000),
  }).catch((e) => ({ status: 0, text: async () => JSON.stringify({ response: `NO ANSWER IN TIME (${e.name})` }) }));
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

export function finish(run) {
  run()
    .catch((e) => {
      failed++;
      console.error('FATAL', e.message);
    })
    .finally(() => {
      console.log(
        failed
          ? `\n❌ ${failed} check(s) failed`
          : '\n✅ all workflow checks passed',
      );
      process.exit(failed ? 1 : 0);
    });
}
