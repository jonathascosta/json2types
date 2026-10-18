// Runs Lighthouse on every page of the built site, on a phone (Lighthouse's default: a mid-range
// device on a slow 4G connection, simulated) and on a desktop, and fails if performance,
// accessibility, best practices or SEO score below 95. Run `npm run build` first.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { preview } from 'vite';

const PAGES = ['/', '/csharp/', '/typescript/'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const MINIMUM = 0.95;
const DEBUGGING_PORT = 9223;

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  args: [`--remote-debugging-port=${String(DEBUGGING_PORT)}`],
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
      const result = await lighthouse(
        `http://127.0.0.1:4174${path}`,
        {
          port: DEBUGGING_PORT,
          output: 'html',
          logLevel: 'error',
          onlyCategories: CATEGORIES,
          // Lighthouse fetches robots.txt from inside the page, which the page's own policy forbids
          // (connect-src 'none'); crawlers fetch it directly. check-dist checks the file instead.
          skipAudits: ['robots-txt'],
        },
        config,
      );
      if (!result) throw new Error(`Lighthouse returned nothing for ${path}`);
      const name = `${device}${path.replaceAll('/', '-')}`.replace(/-$/, '');
      writeFileSync(`lighthouse-report/${name}.html`, String(result.report));
      const scores = CATEGORIES.map((id) => {
        const score = result.lhr.categories[id].score ?? 0;
        if (score < MINIMUM) failures.push(`${device} ${path}: ${id} ${String(Math.round(score * 100))}`);
        return `${id} ${String(Math.round(score * 100))}`;
      });
      console.log(`${device.padEnd(7)} ${path.padEnd(13)} ${scores.join(', ')}`);
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => {
    server.httpServer.close(resolve);
  });
}

if (failures.length > 0) {
  console.error(`Below ${String(MINIMUM * 100)}:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Every page scores ${String(MINIMUM * 100)} or more (reports in lighthouse-report/).`);
