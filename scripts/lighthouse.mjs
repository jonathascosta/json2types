// Runs Lighthouse on every page of the built site, on a phone (Lighthouse's default: a mid-range
// device on a slow 4G connection, simulated) and on a desktop, and fails if performance,
// accessibility, best practices or SEO score below 95. Each page is measured three times and the
// median run counts, as Lighthouse advises, so one noisy run on a shared machine can't fail it.
// Run `npm run build` first.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js';
import { preview } from 'vite';

const PAGES = ['/', '/csharp/', '/typescript/'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const MINIMUM = 0.95;
const RUNS = 3;

/**
 * A port nothing is listening on, so neither the server nor the browser meets another program.
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

const sitePort = await freePort();
const debuggingPort = await freePort();
const server = await preview({
  preview: { host: '127.0.0.1', port: sitePort, strictPort: true },
  logLevel: 'silent',
});
const browser = await chromium.launch({
  args: [`--remote-debugging-port=${String(debuggingPort)}`],
  // A Chromium of the machine's own, when Playwright's isn't installed.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});

/** @type {string[]} */
const failures = [];
mkdirSync('lighthouse-report', { recursive: true });
try {
  for (const [device, config] of /** @type {const} */ ([
    ['phone', undefined],
    ['desktop', desktopConfig],
  ])) {
    for (const path of PAGES) {
      /** @type {import('lighthouse').RunnerResult[]} */
      const runs = [];
      for (let run = 0; run < RUNS; run++) {
        const result = await lighthouse(
          `http://127.0.0.1:${String(sitePort)}${path}`,
          {
            port: debuggingPort,
            output: 'html',
            logLevel: 'error',
            onlyCategories: CATEGORIES,
            // Lighthouse fetches robots.txt from inside the page, which the page's own policy
            // forbids (connect-src 'none'); crawlers fetch it directly. check-dist checks the file.
            skipAudits: ['robots-txt'],
          },
          config,
        );
        if (!result) throw new Error(`Lighthouse returned nothing for ${path}`);
        const { runtimeError } = result.lhr;
        if (runtimeError) throw new Error(`${device} ${path}: ${runtimeError.code} ${runtimeError.message}`);
        runs.push(result);
      }
      // Its types name Lighthouse's global LH namespace, which isn't in scope here; it returns one of
      // the results given.
      const median = /** @type {unknown} */ (computeMedianRun(runs.map((r) => r.lhr)));
      const chosen = runs.find((r) => r.lhr === median);
      if (!chosen) throw new Error(`No Lighthouse run for ${path}`);
      const name = `${device}${path.replaceAll('/', '-')}`.replace(/-$/, '');
      writeFileSync(`lighthouse-report/${name}.html`, String(chosen.report));
      const scores = CATEGORIES.map((id) => {
        const score = chosen.lhr.categories[id].score ?? 0;
        if (score < MINIMUM) failures.push(`${device} ${path}: ${id} ${String(Math.round(score * 100))}`);
        return `${id} ${String(Math.round(score * 100))}`;
      });
      console.log(`${device.padEnd(7)} ${path.padEnd(13)} ${scores.join(', ')}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.error(`Below ${String(MINIMUM * 100)}:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Every page scores ${String(MINIMUM * 100)} or more (reports in lighthouse-report/).`);
