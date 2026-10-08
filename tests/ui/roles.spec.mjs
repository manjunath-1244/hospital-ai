/**
 * Browser tests: sign in through the UI as each of the 9 seeded logins and check what the role SEES and CAN DO,
 * that no red error banner appears and that no API call to the backend fails with 401/403/5xx.
 * Run against the already running stack: `npm run test:ui` (UI on 3001, API on 3000).
 */
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000';
const PASSWORD = process.env.SEED_USER_PASSWORD;

const h = (page, name, exact = false) => page.getByRole('heading', { name, exact }).first();
const testid = (page, id) => page.getByTestId(id);

/** Open a fresh page, collect backend failures and sign in through the login form. */
async function signIn(browser, username) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = [];
  const requests = [];
  page.on('request', (r) => r.url().startsWith(API) && requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
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
  return { context, page, failures, requests };
}

/** Let the portal's initial loads settle (no spinners left), then assert it is clean. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 15_000 });
}
async function expectClean(page, failures) {
  await settle(page);
  await expect(testid(page, 'error-banner'), 'red error banner visible').toHaveCount(0);
  expect(failures, 'failed API calls (401/403/5xx)').toEqual([]);
}

async function commonChecks(page) {
  await expect(testid(page, 'notification-bell')).toBeVisible();
  await testid(page, 'chat-toggle').click();
  await expect(testid(page, 'chat-drawer')).toBeVisible();
  await expect(h(page, 'AI Assistant')).toBeVisible();
  await page.getByRole('button', { name: 'Close AI assistant' }).click();
  await expect(testid(page, 'chat-drawer')).toHaveCount(0);
}

const ABSENT_COMMON = {
  register: (p) => h(p, 'OP Patient Registration'),
  triage: (p) => h(p, /Triage Vitals Entry/),
  lab: (p) => testid(p, 'lab-form'),
  doctorWorkbench: (p) => h(p, 'Physician EMR Workbench'),
  dicom: (p) => h(p, /Upload DICOM Study/),
  pharmacy: (p) => h(p, 'Prescription Queue'),
  adminHealth: (p) => h(p, /Service Health/),
  patientPicker: (p) => testid(p, 'patient-picker'),
  patientList: (p) => testid(p, 'patient-list-item'),
  booking: (p) => testid(p, 'appointment-booking'),
};
const absent = (page, ...keys) => Promise.all(keys.map((k) => expect(ABSENT_COMMON[k](page), `must NOT show: ${k}`).toHaveCount(0)));

test.beforeAll(() => {
  if (!PASSWORD) throw new Error('SEED_USER_PASSWORD is not set (read from .env)');
});

test.describe('role portals', () => {
  test('receptionist', async ({ browser }) => {
    const { context, page, failures } = await signIn(browser, 'receptionist');
    try {
      await expect(h(page, /Front-Desk Outpatient Registration/)).toBeVisible();
      await expect(h(page, /OP Patient Registration/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Register OP Patient' })).toBeVisible();
      await expect(h(page, /Outpatient Queue/)).toBeVisible();
      await expect(testid(page, 'appointment-booking')).toBeVisible();
      await absent(page, 'triage', 'lab', 'doctorWorkbench', 'dicom', 'pharmacy', 'adminHealth');
      await commonChecks(page);
      await expectClean(page, failures);
    } finally { await context.close(); }
  });

  test('nurse', async ({ browser }) => {
    const { context, page, failures } = await signIn(browser, 'nurse');
    try {
      await expect(h(page, /ED Triage/)).toBeVisible();
      await expect(h(page, /Triage Vitals Entry/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Submit triage vitals' })).toBeVisible();
      await expect(h(page, /Waiting for Triage/)).toBeVisible();
      await expect(h(page, /Ward Monitoring/)).toBeVisible();
      await expect(h(page, /Ward NEWS2 Overview/)).toBeVisible();
      await expect(h(page, /SBAR Handoff/)).toBeVisible();
      await absent(page, 'register', 'doctorWorkbench', 'dicom', 'pharmacy', 'adminHealth', 'booking');
      await commonChecks(page);
      await expectClean(page, failures);
    } finally { await context.close(); }
  });

  test('doctor', async ({ browser }) => {
    const { context, page, failures } = await signIn(browser, 'doctor');
    try {
      await expect(h(page, /Physician EMR Workbench/)).toBeVisible();
      await expect(h(page, 'Patients')).toBeVisible();
      await expect(testid(page, 'patient-list-item').first()).toBeVisible();
      await expect(testid(page, 'appointment-booking')).toBeVisible();
      await expect(h(page, /Pending actions/)).toBeVisible();
      // Open patients until one with a visit shows the follow-up panel.
      const items = testid(page, 'patient-list-item');
      const n = Math.min(await items.count(), 6);
      let followUp = false;
      for (let i = 0; i < n && !followUp; i++) {
        await items.nth(i).click();
        await expect(h(page, 'Referrals', true)).toBeVisible();
        await expect(testid(page, 'lab-form')).toBeVisible();
        await settle(page);
        followUp = (await h(page, /Follow-up plan/).count()) > 0;
      }
      await expect(h(page, /Record Consultation/)).toBeVisible();
      expect(followUp, 'no patient with a visit showed the follow-up panel').toBe(true);
      await absent(page, 'register', 'triage', 'dicom', 'pharmacy', 'adminHealth');
      await commonChecks(page);
      await expectClean(page, failures);
    } finally { await context.close(); }
  });

  test('radiologist', async ({ browser }) => {
    const { context, page, failures } = await signIn(browser, 'radiologist');
    try {
      await expect(h(page, /Radiology: DICOM/)).toBeVisible();
      await expect(h(page, /Upload DICOM Study/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible();
      await expect(testid(page, 'lab-form')).toBeVisible();
      await expect(testid(page, 'patient-picker')).toBeVisible();
      await absent(page, 'register', 'triage', 'doctorWorkbench', 'pharmacy', 'adminHealth', 'booking');
      await commonChecks(page);
      await expectClean(page, failures);
    } finally { await context.close(); }
  });

  test('pharmacist', async ({ browser }) => {
    const { context, page, failures } = await signIn(browser, 'pharmacist');
    try {
      await expect(h(page, /Clinical Pharmacy/)).toBeVisible();
      await expect(h(page, 'Prescription Queue')).toBeVisible();
      await expect(h(page, /Ad-hoc Medication Audit/)).toBeVisible();
      await expect(testid(page, 'patient-picker')).toBeVisible();
      await absent(page, 'register', 'triage', 'lab', 'doctorWorkbench', 'dicom', 'adminHealth', 'booking');
      await commonChecks(page);
      await expectClean(page, failures);
    } finally { await context.close(); }
  });

  test('coordinator', async ({ browser }) => {
    const { context, page, failures } = await signIn(browser, 'coordinator');
    try {
      await expect(h(page, /Care Coordination/)).toBeVisible();
      await expect(h(page, /Prior Authorization Draft/)).toBeVisible();
      await expect(h(page, /Discharge Instructions Translation/)).toBeVisible();
      await expect(testid(page, 'patient-picker')).toBeVisible();
      await absent(page, 'register', 'triage', 'lab', 'doctorWorkbench', 'dicom', 'pharmacy', 'adminHealth', 'booking');
      await commonChecks(page);
      await expectClean(page, failures);
    } finally { await context.close(); }
  });

  test('admin', async ({ browser }) => {
    const { context, page, failures } = await signIn(browser, 'admin');
    try {
      await expect(h(page, /Administration/)).toBeVisible();
      await expect(h(page, 'Hospital Overview')).toBeVisible();
      await expect(h(page, /Service Health/)).toBeVisible();
      await expect(h(page, /Audit Log/)).toBeVisible();
      await expect(h(page, /Agent observability/)).toBeVisible();
      await expect(h(page, /Hospital Knowledge Base/)).toBeVisible();
      await expect(h(page, /Patient Management/)).toBeVisible();
      await expect(h(page, /Specialists/, false).first()).toBeVisible();
      await expect(h(page, /Pending actions/)).toBeVisible();
      await expect(page.getByText('View as:')).toBeVisible();
      await absent(page, 'lab', 'triage', 'register');
      await commonChecks(page);
      await expectClean(page, failures);
    } finally { await context.close(); }
  });

  for (const user of ['cardiologist', 'neurologist']) {
    test(user, async ({ browser }) => {
      const { context, page, failures, requests } = await signIn(browser, user);
      try {
        await expect(h(page, /My consultations/)).toBeVisible();
        await expect(page.getByRole('button', { name: /Available for bookings|Not available/ })).toBeVisible();
        await expect(h(page, 'Weekly hours')).toBeVisible();
        await expect(h(page, 'My upcoming appointments')).toBeVisible();
        await absent(page, 'patientPicker', 'patientList', 'register', 'triage', 'lab', 'doctorWorkbench', 'dicom', 'pharmacy', 'adminHealth', 'booking');
        await expect(h(page, 'Patients', true)).toHaveCount(0);
        // Open the first consultation (if any): the chart comes from the allowed /summary endpoint.
        await settle(page);
        const first = testid(page, 'consultations-inbox').locator('button').first();
        if (await first.count()) {
          await first.click();
          await expect(h(page, /Patient chart summary/)).toBeVisible();
          await expect(h(page, /Complete consultation/)).toBeVisible();
          await expect(testid(page, 'consultation-detail').getByText('Unknown', { exact: true })).toHaveCount(0);
        }
        await commonChecks(page);
        await expectClean(page, failures);
        const forbidden = requests.filter((r) => /^GET \/hospital\/patients(\/[^/]+)?$/.test(r) || r === 'GET /hospital/visits' || r === 'GET /hospital/overview');
        expect(forbidden, 'specialist must not call these endpoints').toEqual([]);
      } finally { await context.close(); }
    });
  }

  test('admin "View as" switches portals without errors', async ({ browser }) => {
    test.setTimeout(180_000);
    // The login endpoint allows 10 attempts a minute and the nine role tests above already used nine of them.
    await new Promise((r) => setTimeout(r, 62_000));
    const { context, page, failures } = await signIn(browser, 'admin');
    try {
      const views = [
        ['Receptionist', /Front-Desk Outpatient Registration/],
        ['Nurse', /ED Triage/],
        ['Doctor', /Physician EMR Workbench/],
        ['Radiologist', /Radiology: DICOM/],
        ['Pharmacist', /Clinical Pharmacy/],
        ['Care Coordinator', /Care Coordination/],
        ['Specialist', /My consultations/],
        ['Admin', /Administration/],
      ];
      for (const [label, heading] of views) {
        await page.getByRole('button', { name: label, exact: true }).click();
        await expect(h(page, heading).first(), `view as ${label}`).toBeVisible();
        await settle(page);
        await expect(testid(page, 'error-banner'), `error banner when viewing as ${label}`).toHaveCount(0);
        expect(failures, `failed API calls when viewing as ${label}`).toEqual([]);
      }
    } finally { await context.close(); }
  });
});
