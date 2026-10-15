import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // Six software-WebGL (swiftshader) workers flake on a normal machine ("session closed"); four are stable. CI picks its own.
  workers: process.env.CI ? undefined : 4,
  // Headless Chromium now and then drops the file chooser for a keyboard Enter when the machine is busy; one retry covers it.
  retries: 1,
  // On CI the github reporter turns each failure into an annotation of the run, readable without the logs.
  reporter: process.env.CI ? [['github'], ['dot']] : 'list',
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL so the 3D view renders in headless CI.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    // Not run by `npm run e2e` or CI (they pass --project=chromium): `npx playwright test --project=firefox`.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
