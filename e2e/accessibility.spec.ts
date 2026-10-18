import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PAGES = ['/', '/csharp/', '/typescript/', '/404.html'];

// Every page, in light and dark, on a desktop and a phone (the two projects), and the converter in
// each state that draws something of its own: no rule of WCAG 2.2 AA, or of axe's best practices,
// may fail, and none may be left undecided.
for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });

    for (const path of PAGES) {
      test(`${path} has no accessibility violations`, async ({ page }) => {
        await page.goto(path);
        await expectNoViolations(page);
        if (path === '/404.html') return;

        await page.getByRole('button', { name: 'Try a sample' }).click();
        await expect(page.locator('#code')).not.toBeEmpty();
        await expectNoViolations(page);

        // Warnings, drawn in their own colour.
        await page.locator('#input').fill('{"mixed": [1, "x"], "nothing": null}');
        await expect(page.locator('#notes li.warning')).toHaveCount(1);
        await expectNoViolations(page);

        await page.locator('#input').fill('{"a": 1,');
        await expect(page.locator('#error')).toBeVisible();
        await expectNoViolations(page);
      });
    }

    test('the home page in TypeScript, and the note on a JSON too large to remember', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('form', { name: 'Converter' }).getByText('TypeScript', { exact: true }).click();
      await page.getByLabel('Remember my JSON in this browser').check();
      await page.locator('#input').evaluate((e: HTMLTextAreaElement) => {
        e.value = JSON.stringify(Array.from({ length: 60_000 }, (_, i) => ({ i, s: 'xxxxxxxx' })));
        e.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect(page.locator('#remember-note')).toBeVisible();
      await expect(page.locator('#code')).toContainText('export interface Root');
      await expectNoViolations(page);
    });
  });
}

test('the converter fits a 320 px screen without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of PAGES) {
    await page.goto(path);
    if (path !== '/404.html') {
      await page.getByRole('button', { name: 'Try a sample' }).click();
      await expect(page.locator('#code')).not.toBeEmpty();
    }
    // clientWidth, not innerWidth: a phone browser widens its viewport to fit content that overflows.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('the keyboard reaches the converter first through the skip link', async ({ page }) => {
  await page.goto('/csharp/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Root type name')).toBeFocused();
});

async function expectNoViolations(page: Page): Promise<void> {
  // The page shows itself once its script has run (the frame gate); scanning before would only
  // report a page with no visible content.
  await expect(page.getByRole('main')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const describe = (items: typeof results.violations) =>
    items.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(describe(results.violations)).toEqual([]);
  expect(describe(results.incomplete), 'checks axe could not decide').toEqual([]);
}
