/** Small helpers shared by the workflow scripts (run against a RUNNING API; see package.json `test:workflow`). */
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

export async function login(...usernames) {
  if (!PASSWORD) throw new Error('SEED_USER_PASSWORD is not set');
  for (const u of usernames) {
    const r = await call(null, 'POST', '/auth/login', {
      username: u,
      password: PASSWORD,
    });
    tokens[u] = r.body.accessToken;
    if (!tokens[u])
      throw new Error(`login failed for ${u}: ${JSON.stringify(r.body)}`);
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
  });
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
