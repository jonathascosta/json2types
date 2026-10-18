import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGES = ['/', '/csharp/', '/typescript/', '/404.html'];

// Every page, in light and dark, on a desktop and a phone (the two projects), and the converter in
// each of its states: no rule of WCAG 2.2 AA, or of axe's best practices, may fail.
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

        await page.locator('#input').fill('{"a": 1,');
        await expect(page.locator('#error')).toBeVisible();
        await expectNoViolations(page);
      });
    }
  });
}

test('the page fits a 320 px screen without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of PAGES) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
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
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}
