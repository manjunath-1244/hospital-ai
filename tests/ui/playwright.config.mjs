import { defineConfig } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Read the seeded password from .env without printing it anywhere.
if (!process.env.SEED_USER_PASSWORD && existsSync(join(root, '.env'))) {
  const m = readFileSync(join(root, '.env'), 'utf8').match(/^SEED_USER_PASSWORD=(.*)$/m);
  if (m) process.env.SEED_USER_PASSWORD = m[1].trim().replace(/^["']|["']$/g, '');
}

const chrome = process.env.UI_CHROME_PATH || '/usr/bin/google-chrome';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1, // one browser at a time (the machine is short on RAM)
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.UI_URL || 'http://localhost:3001',
    headless: true,
    launchOptions: { executablePath: chrome, args: ['--disable-gpu', '--no-sandbox'] },
  },
});
