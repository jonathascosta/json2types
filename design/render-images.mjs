// Renders the social preview images (public/og/*.png, 1200×630) and the Apple touch icon
// (public/apple-touch-icon.png, 180×180). Not part of the build: run it by hand when a page's title
// or the generated code changes, from a folder where playwright-core is installed:
//   node design/render-images.mjs   (CHROMIUM_PATH=/path/to/chromium if Playwright has no browser)
// The code shown is the converter's real output for the JSON beside it, trimmed to the class body.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const favicon = readFileSync(`${repo}/public/favicon.svg`, 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cards = {
  home: {
    title: 'JSON to C# and TypeScript types',
    size: 14,
    left: '{\n  "id": 1042,\n  "name": "Ana"\n}',
    right:
      'public class Root\n{\n    [JsonPropertyName("id")]\n    public int Id { get; set; }\n    [JsonPropertyName("name")]\n    public string Name { get; set; } = "";\n}\n\nexport interface Root {\n  id: number;\n  name: string;\n}',
  },
  csharp: {
    title: 'JSON to C# classes and records',
    size: 17,
    left: '{\n  "first_name": "Ana",\n  "placed": "2026-10-18T12:30:00Z"\n}',
    right:
      'public class Root\n{\n    [JsonPropertyName("first_name")]\n    public string FirstName { get; set; } = "";\n    [JsonPropertyName("placed")]\n    public DateTimeOffset Placed { get; set; }\n}',
  },
  typescript: {
    title: 'JSON to TypeScript interfaces',
    size: 17,
    left: '{\n  "id": 1042,\n  "first-name": "Ana",\n  "tags": ["new", null],\n  "email": null\n}',
    right:
      'export interface Root {\n  id: number;\n  "first-name": string;\n  tags: (string | null)[];\n  email: unknown;\n}',
  },
};
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [name, c] of Object.entries(cards)) {
  await page.setContent(`<!doctype html><html><head><style>
    body{margin:0;width:1200px;height:630px;background:#0f0f0e;color:#f2f1ed;font-family:system-ui,sans-serif;display:flex;flex-direction:column;padding:64px 72px;box-sizing:border-box}
    .top{display:flex;align-items:center;gap:24px}
    .top svg{width:72px;height:72px}
    .brand{font:700 44px/1 ui-monospace,monospace}
    h1{font-size:52px;line-height:1.1;margin:30px 0 30px;font-weight:700}
    .code{display:flex;gap:28px;flex:1;min-height:0}
    pre{flex:1;margin:0;padding:22px 26px;border:1px solid #3a3935;border-radius:14px;background:#1a1a18;font:var(--size)/1.55 ui-monospace,monospace;overflow:hidden;white-space:pre}
    pre.out{border-color:#ff8a5b;flex:1.3}
    .arrow{align-self:center;color:#ff8a5b;font:700 44px monospace}
  </style></head><body style="--size:${c.size}px">
    <div class="top">${favicon}<span class="brand">json2types</span></div>
    <h1>${esc(c.title)}</h1>
    <div class="code"><pre>${esc(c.left)}</pre><span class="arrow">→</span><pre class="out">${esc(c.right)}</pre></div>
  </body></html>`);
  await page.screenshot({ path: `${repo}/public/og/${name}.png` });
}
const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.setContent(
  `<!doctype html><html><body style="margin:0;background:#1a1917">${favicon.replace('<svg ', '<svg width="180" height="180" ')}</body></html>`,
);
await icon.screenshot({ path: `${repo}/public/apple-touch-icon.png` });
await browser.close();
