import { expect, test } from '@playwright/test';

test('each page has its own title, heading and canonical, and marks itself in the nav', async ({ page }) => {
  const pages = [
    ['/', 'json2types', 'Home', 'https://json2types.jonathas.net/'],
    ['/csharp/', 'JSON to C#', 'JSON to C#', 'https://json2types.jonathas.net/csharp/'],
    [
      '/typescript/',
      'JSON to TypeScript',
      'JSON to TypeScript',
      'https://json2types.jonathas.net/typescript/',
    ],
  ];
  const titles = new Set<string>();
  for (const [path, heading, current, canonical] of pages) {
    await page.goto(path ?? '');
    titles.add(await page.title());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading ?? '');
    await expect(page.locator('nav [aria-current="page"]')).toHaveText(current ?? '');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical ?? '');
    await expect(
      page.getByText('Everything runs in your browser: nothing you paste is uploaded.').first(),
    ).toBeVisible();
  }
  expect(titles.size).toBe(3);
});

test('a language page has no language switch and only its own options', async ({ page }) => {
  await page.goto('/typescript/');
  await expect(page.locator('input[type=radio][name=language]')).toHaveCount(0);
  await expect(page.locator('#csharp-options')).toHaveCount(0);
  await expect(page.getByLabel('Read-only')).toBeVisible();
});

test('the home page links to both language pages', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.cards')
    .getByRole('link', { name: /JSON to C#/ })
    .click();
  await expect(page).toHaveURL(/\/csharp\/$/);
});

test('the not-found page is kept out of search and leads back', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.getByRole('main').getByRole('link', { name: 'home page' })).toHaveAttribute('href', '/');
});
