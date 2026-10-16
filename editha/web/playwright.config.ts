import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Una cartella per esecuzione, condivisa con i worker tramite l'ambiente.
process.env.EDITHA_E2E_ROOT ??= mkdtempSync(path.join(os.tmpdir(), 'editha-e2e-'));
const PORT = 8098;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { EDITHA_PORT: String(PORT), EDITHA_E2E_ROOT: process.env.EDITHA_E2E_ROOT },
    stdout: 'pipe',
  },
});
