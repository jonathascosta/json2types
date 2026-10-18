import { expect, test } from './fixtures';

const LANGUAGE_PAGES = [
  { path: '/csharp/', heading: 'JSON to C#', own: '#csharp-options', other: '#typescript-options' },
  {
    path: '/typescript/',
    heading: 'JSON to TypeScript',
    own: '#typescript-options',
    other: '#csharp-options',
  },
] as const;

test('each page has its own title, heading and canonical, and marks itself in the nav', async ({ page }) => {
  const pages = [
    { path: '/', heading: 'json2types', current: 'Home' },
    ...LANGUAGE_PAGES.map((p) => ({ ...p, current: p.heading })),
  ];
  const titles = new Set<string>();
  for (const { path, heading, current } of pages) {
    await page.goto(path);
    titles.add(await page.title());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.locator('nav [aria-current="page"]')).toHaveText(current);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://json2types.jonathas.net${path}`,
    );
    await expect(page.locator('.privacy')).toHaveText(
      'Everything runs in your browser: nothing you paste is uploaded.',
    );
  }
  expect(titles.size).toBe(3);
});

for (const { path, own, other } of LANGUAGE_PAGES) {
  test(`${path} has no language switch and only its own options`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('input[type=radio][name=language]')).toHaveCount(0);
    await expect(page.locator(other)).toHaveCount(0);
    await expect(page.locator(own)).toBeVisible();
  });
}

test('the home page links to both language pages', async ({ page }) => {
  for (const { path, heading } of LANGUAGE_PAGES) {
    await page.goto('/');
    await page.locator('.cards').getByRole('link', { name: heading }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});

test('the not-found page is kept out of search and leads back', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.getByRole('main').getByRole('link', { name: 'home page' })).toHaveAttribute('href', '/');
});
