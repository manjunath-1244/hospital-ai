/**
 * One complete patient journey through the REAL UI, each role in its own browser context, one at a time:
 * receptionist registers -> nurse triages -> doctor consults / lab / referral -> cardiologist completes ->
 * doctor follow-up plan (approval + execution) -> chat instant answers -> cleanup via the API as admin.
 * Run: `npm run test:ui -- journey` (UI on 3001, API on 3000).
 */
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000';
const PASSWORD = process.env.SEED_USER_PASSWORD;

const testid = (page, id) => page.getByTestId(id);
const h = (page, name, exact = false) => page.getByRole('heading', { name, exact }).first();
/** The input/textarea/select that follows a <label> (the app's labels are not bound with htmlFor). */
const field = (scope, label) =>
  scope.locator(`xpath=.//label[contains(normalize-space(.),"${label}")]/following-sibling::*[self::input or self::textarea or self::select][1]`).first();

const unique = String(Math.floor(100000 + Math.random() * 900000));
const NAME = `Journey Test ${unique}`;
const PHONE = `+1555${unique}9`;

const S = { patientId: '', adminToken: '', aiSummary: '', notes: [] };

async function signIn(browser, username) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = [];
  page.on('response', (r) => {
    if (r.url().startsWith(API) && (r.status() === 401 || r.status() === 403 || r.status() >= 500))
      failures.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  await page.goto('/');
  await expect(h(page, 'Sign in')).toBeVisible();
  await testid(page, 'login-username').fill(username);
  await testid(page, 'login-password').fill(PASSWORD);
  await testid(page, 'login-submit').click();
  await expect(testid(page, 'notification-bell')).toBeVisible();
  return { context, page, failures };
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 15_000 });
}
/** No red banner, no 401/403/5xx. `allowBanner` for steps where a banner is the expected UI. */
async function clean(page, failures, label, allowBanner = false) {
  await settle(page);
  if (!allowBanner) await expect(testid(page, 'error-banner'), `${label}: red error banner`).toHaveCount(0);
  expect(failures, `${label}: failed API calls`).toEqual([]);
}
const token = (page) => page.evaluate(() => localStorage.getItem('mk.token'));
async function api(request, tok, method, path) {
  const res = await request.fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${tok}` } });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error('SEED_USER_PASSWORD is not set (read from .env)');
});

test.afterAll(async ({ playwright }) => {
  if (!S.patientId) return;
  const request = await playwright.request.newContext();
  try {
    let tok = '';
    for (let i = 0; i < 3 && !tok; i++) {
      const res = await request.post(`${API}/auth/login`, { data: { username: 'admin', password: PASSWORD } });
      if (res.ok()) tok = (await res.json()).accessToken;
      else await new Promise((r) => setTimeout(r, 20_000));
    }
    expect(tok, 'admin login for cleanup').toBeTruthy();
    const del = await request.delete(`${API}/hospital/patients/${S.patientId}?confirm=${S.patientId}`, { headers: { Authorization: `Bearer ${tok}` } });
    console.log(`cleanup: DELETE patient ${S.patientId} -> ${del.status()}`);
    expect(del.status(), 'cleanup delete').toBeLessThan(300);
  } finally {
    await request.dispose();
  }
});

test('complete patient journey through the real UI', async ({ browser, request }) => {
  test.setTimeout(900_000);
  // Earlier suites may have used the login quota (10 attempts per minute).
  await new Promise((r) => setTimeout(r, 62_000));

  // ---------- 1 + 2. Receptionist ----------
  {
    const { context, page, failures } = await signIn(browser, 'receptionist');
    try {
      await test.step('1. register patient and see the queue', async () => {
        await expect(h(page, /OP Patient Registration/)).toBeVisible();
        const form = page.locator('form', { has: page.getByRole('button', { name: 'Register OP Patient' }) });
        await field(form, 'Full Name').fill(NAME);
        await field(form, 'Age').fill('58');
        await field(form, 'Phone').fill(PHONE);
        await field(form, 'Chief Complaint').fill('Acute severe chest pain');
        await form.getByRole('button', { name: 'Register OP Patient' }).click();
        const ok = page.getByText(new RegExp(`Patient ${NAME} registered as (\\S+)\\.`));
        await expect(ok).toBeVisible();
        S.patientId = (await ok.innerText()).match(/registered as (\S+?)\./)[1];
        const row = page.getByRole('row').filter({ hasText: NAME });
        await expect(row).toBeVisible();
        await expect(row.getByText('Waiting for triage')).toBeVisible();
        await expect(row.getByText('Acute severe chest pain')).toBeVisible();
        await clean(page, failures, 'step 1');
      });

      await test.step('2. duplicate registration shows possible matches', async () => {
        const form = page.locator('form', { has: page.getByRole('button', { name: 'Register OP Patient' }) });
        await field(form, 'Full Name').fill(NAME);
        await field(form, 'Age').fill('58');
        await field(form, 'Phone').fill(PHONE);
        await form.getByRole('button', { name: 'Register OP Patient' }).click();
        await expect(page.getByText(/Possible existing patient/)).toBeVisible();
        await expect(form.getByText(S.patientId).first()).toBeVisible();
        await expect(form.getByRole('button', { name: /Open this patient/ })).toBeVisible();
        await expect(form.getByRole('button', { name: /register anyway/ })).toBeVisible();
        // The red banner (409 message) is the expected UI here; only backend failures are checked.
        await clean(page, failures, 'step 2', true);
      });
    } finally { await context.close(); }
  }

  // ---------- 3. Nurse ----------
  {
    const { context, page, failures } = await signIn(browser, 'nurse');
    try {
      await test.step('3. nurse triage', async () => {
        await expect(h(page, /Triage Vitals Entry/)).toBeVisible();
        await page.getByRole('button', { name: new RegExp(NAME) }).click(); // waiting-for-triage card
        const form = page.locator('form', { has: page.getByRole('button', { name: 'Submit triage vitals' }) });
        await expect(testid(form, 'patient-picker')).toHaveValue(S.patientId);
        await field(form, 'Heart Rate').fill('115');
        await field(form, 'Systolic BP').fill('165');
        await field(form, 'SpO2 (%)').fill('94');
        await field(form, 'Temperature').fill('37.8');
        await field(form, 'Respiratory Rate').fill('24');
        await field(form, 'Consciousness').selectOption('ALERT');
        await field(form, 'Symptoms').fill('chest pain');
        await form.getByRole('button', { name: 'Submit triage vitals' }).click();
        await expect(page.getByText(/NEWS2 \d+/).first()).toBeVisible();
        await expect(page.getByText(/Visit is now/)).toContainText('Waiting for doctor');
        await clean(page, failures, 'step 3');
      });
    } finally { await context.close(); }
  }

  // ---------- 4 + 6. Doctor (the same context is kept for step 6, so realtime updates are really tested) ----------
  const doctor = await signIn(browser, 'doctor');
  const dp = doctor.page;
  try {
    await test.step('4a. doctor opens patient and records consultation', async () => {
      await expect(h(dp, /Physician EMR Workbench/)).toBeVisible();
      await dp.getByPlaceholder('Search by name or ID').fill(NAME);
      const item = testid(dp, 'patient-list-item').filter({ hasText: NAME });
      await expect(item).toHaveCount(1);
      await expect(item.getByText('Waiting for doctor')).toBeVisible();
      await item.click();
      await expect(h(dp, /Record Consultation/)).toBeVisible();
      const form = dp.locator('form', { has: dp.getByRole('button', { name: 'Record consultation' }) });
      await field(form, 'Diagnosis').fill('Suspected acute coronary syndrome');
      await field(form, 'Clinical notes').fill('Crushing chest pain radiating to left arm, diaphoretic, ECG ordered.');
      await form.getByRole('button', { name: 'Record consultation' }).click();
      await expect(dp.getByText(/Consultation \S+ recorded for/)).toBeVisible();
      await clean(dp, doctor.failures, 'step 4a');
    });

    await test.step('4b. lab result Troponin T 0.85 ng/mL', async () => {
      const lab = testid(dp, 'lab-form');
      await field(lab, 'Test name').fill('Troponin T');
      await field(lab, 'Value').fill('0.85');
      await field(lab, 'Unit').fill('ng/mL');
      await lab.getByRole('button', { name: 'Save lab result' }).click();
      await expect(lab.getByText(/Lab result recorded/)).toBeVisible();
      await expect(dp.getByRole('row').filter({ hasText: 'Troponin T' }).first()).toBeVisible();
      await clean(dp, doctor.failures, 'step 4b');
    });

    await test.step('4c. review for specialist (rules engine) recommends Cardiology with evidence', async () => {
      await dp.getByRole('button', { name: 'Review for specialist' }).click();
      await expect(dp.getByText(/Recommend Cardiology/)).toBeVisible({ timeout: 30_000 });
      await expect(dp.getByText('Evidence', { exact: true })).toBeVisible();
      await expect(dp.getByText(/Troponin/i).filter({ hasNot: dp.locator('table') }).first()).toBeVisible();
      await clean(dp, doctor.failures, 'step 4c');
    });

    await test.step('4d. manual referral form', async () => {
      const refForm = dp.locator('form', { has: dp.getByRole('button', { name: 'Refer to specialist' }) });
      await field(refForm, 'Specialty').selectOption({ label: 'Cardiology' });
      await field(refForm, 'Urgency').selectOption('URGENT');
      await field(refForm, 'Reason').fill('Chest pain with raised troponin T 0.85 ng/mL, suspected ACS; urgent cardiology opinion.');
      await refForm.getByRole('button', { name: 'Refer to specialist' }).click();
      await expect(dp.getByText(/Referral \S+ created/)).toBeVisible();
      await clean(dp, doctor.failures, 'step 4d');
    });

    // ---------- 5. Cardiologist ----------
    const card = await signIn(browser, 'cardiologist');
    const cp = card.page;
    try {
      await test.step('5a. cardiologist notification bell and centre', async () => {
        await settle(cp);
        const bell = testid(cp, 'notification-bell');
        await expect(bell).toHaveAttribute('aria-label', /[1-9]\d* unread/);
        await bell.click();
        const entry = cp.getByRole('button').filter({ hasText: NAME }).first();
        await expect(entry).toBeVisible();
        await expect(entry).toContainText(/referral/i);
        await bell.click(); // close
        await clean(cp, card.failures, 'step 5a');
      });

      await test.step('5b. my consultations: chart summary', async () => {
        const inbox = testid(cp, 'consultations-inbox');
        await inbox.locator('button').filter({ hasText: NAME }).first().click();
        const detail = testid(cp, 'consultation-detail');
        await expect(h(cp, /Patient chart summary/)).toBeVisible();
        await expect(detail.getByText(NAME).first()).toBeVisible();
        await expect(detail.getByText('Unknown', { exact: true })).toHaveCount(0);
        await expect(detail.getByText(/Troponin T/).first()).toBeVisible();
        await clean(cp, card.failures, 'step 5b');
      });

      await test.step('5c. AI referral summary renders evidence or a clear error', async () => {
        const detail = testid(cp, 'consultation-detail');
        await detail.getByRole('button', { name: /Generate AI summary/ }).click();
        const evidence = detail.getByText('Cited evidence');
        const err = detail.getByTestId('error-banner');
        await expect(evidence.or(err).first()).toBeVisible({ timeout: 25_000 });
        S.aiSummary = (await evidence.count()) ? 'rendered evidence' : `error banner: ${await err.first().innerText()}`;
        console.log(`AI referral summary result: ${S.aiSummary}`);
        if (S.aiSummary === 'rendered evidence') {
          const text = await detail.innerText();
          expect(text, 'cited evidence content').toMatch(/Troponin|troponin/);
        } else {
          expect(S.aiSummary).toMatch(/\S{5}/);
        }
        expect(card.failures, 'step 5c failed API calls').toEqual([]);
      });

      await test.step('5d. complete consultation', async () => {
        const form = cp.locator('form', { has: cp.getByRole('button', { name: 'Complete consultation' }) });
        await field(form, 'Assessment').fill('NSTEMI suspected, troponin elevated.');
        await field(form, 'Recommendation').fill('Admit to cardiac monitoring, start ACS pathway.');
        await field(form, 'Treatment').fill('Aspirin load, anticoagulation, serial ECG.');
        await field(form, 'Follow-up instructions').fill('Repeat troponin and clinic review.');
        await field(form, 'Follow-up tests').fill('Troponin T');
        await field(form, 'Follow-up in (days)').fill('7');
        await form.getByRole('button', { name: 'Complete consultation' }).click();
        await expect(cp.getByText(/Consultation completed; the referring doctor has been notified/)).toBeVisible();
        // The red banner of step 5c (if any) belongs to the AI summary; the completion itself must be clean.
        expect(card.failures, 'step 5d failed API calls').toEqual([]);
      });
    } finally { await card.context.close(); }

    // ---------- 6. Doctor again ----------
    await test.step('6a. doctor: completion notification and Follow-up status', async () => {
      const bell = testid(dp, 'notification-bell');
      await expect(bell).toHaveAttribute('aria-label', /[1-9]\d* unread/, { timeout: 20_000 });
      await bell.click();
      const entry = dp.getByRole('button').filter({ hasText: /completed|consultation/i }).filter({ hasText: NAME }).first();
      await expect(entry).toBeVisible({ timeout: 20_000 });
      await bell.click(); // close
      // Live view first (no reload): the open workbench must reflect the backend's move to Follow-up on its own.
      // Soft assertion: if it fails (stale UI) the test is still marked failed, but we reload and carry on.
      const liveBadge = testid(dp, 'patient-list-item').filter({ hasText: NAME }).getByText('Follow-up', { exact: true });
      await expect.soft(liveBadge, 'LIVE UI (no reload) shows visit status Follow-up after specialist completed').toBeVisible({ timeout: 15_000 });
      if (!(await liveBadge.count())) {
        await dp.reload();
        await dp.getByPlaceholder('Search by name or ID').fill(NAME);
        await testid(dp, 'patient-list-item').filter({ hasText: NAME }).click();
      }
      const summary = testid(dp, 'clinical-summary');
      await expect(summary.getByText('Follow-up', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(testid(dp, 'patient-list-item').filter({ hasText: NAME }).getByText('Follow-up', { exact: true })).toBeVisible();
      await clean(dp, doctor.failures, 'step 6a');
    });

    await test.step('6b. propose follow-up plan, approve, see the real result', async () => {
      const panel = dp.getByTestId('follow-up-panel').last();
      await panel.getByRole('button', { name: 'Propose follow-up plan' }).click();
      const proposal = panel.getByText(/Proposed action:/);
      await expect(proposal).toBeVisible();
      const noteBox = panel.getByText(/Written clinician note/);
      if (await noteBox.count()) await field(panel, 'Written clinician note').fill('Reviewed with the cardiologist, approved.');
      await panel.getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(panel.getByText(/Done and verified/)).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByText('Lab order', { exact: true }).first()).toBeVisible();
      await expect(panel.getByText('Appointment', { exact: true }).first()).toBeVisible();
      await clean(dp, doctor.failures, 'step 6b');
    });

    await test.step('6c. lab order and follow-up appointment exist for the patient', async () => {
      const tok = await token(dp);
      const labs = await api(request, tok, 'GET', `/hospital/lab-orders?patientId=${S.patientId}`);
      expect(labs.status).toBe(200);
      expect(JSON.stringify(labs.body), 'lab order for Troponin T').toMatch(/Troponin/i);
      const appts = await api(request, tok, 'GET', '/hospital/appointments');
      expect(appts.status).toBe(200);
      expect(JSON.stringify(appts.body), 'appointment for the patient').toContain(S.patientId);
    });

    await test.step('6d. complete the visit', async () => {
      const visit = dp.locator('div', { has: dp.getByText('Current visit') }).last();
      await dp.getByRole('button', { name: 'Complete visit' }).click();
      await dp.getByRole('button', { name: 'Confirm' }).click();
      await expect(dp.getByText(/This visit is completed/)).toBeVisible({ timeout: 20_000 });
      void visit;
      await clean(dp, doctor.failures, 'step 6d');
    });

    // ---------- 7. Chat (instant, no model) ----------
    await test.step('7. chat: how many specialists, then a clarification', async () => {
      await testid(dp, 'chat-toggle').click();
      const drawer = testid(dp, 'chat-drawer');
      await expect(drawer).toBeVisible();
      const input = drawer.getByPlaceholder('Ask the assistant...');
      await input.fill('how many specialists are there');
      await input.press('Enter');
      const reply = drawer.getByTestId('chat-message-agent').last();
      await expect(reply).toBeVisible({ timeout: 20_000 });
      await expect(reply).toContainText(/Cardiolog/i);
      await expect(reply).toContainText(/Neurolog/i);
      expect(await drawer.getByText(/Thinking/).count(), 'answer must not go through the model').toBe(0);
      const first = await reply.innerText();
      console.log(`chat answer 1: ${first.slice(0, 300).replace(/\n/g, ' | ')}`);

      await input.fill('how many');
      await input.press('Enter');
      await expect(drawer.getByTestId('chat-message-agent')).toHaveCount(2, { timeout: 20_000 });
      const second = drawer.getByTestId('chat-message-agent').last();
      await expect(second).toContainText(/what|which|clarif|count/i);
      console.log(`chat answer 2: ${(await second.innerText()).slice(0, 300).replace(/\n/g, ' | ')}`);
      expect(doctor.failures, 'step 7 failed API calls').toEqual([]);
      await expect(drawer.getByTestId('error-banner')).toHaveCount(0);
    });
  } finally {
    await doctor.context.close();
  }
});
