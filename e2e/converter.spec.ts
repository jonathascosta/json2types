import { expect, test, type Page } from '@playwright/test';

/** Types the JSON as a paste would put it, and waits for the code. */
async function paste(page: Page, json: string): Promise<void> {
  await page.locator('#input').fill(json);
}

const code = (page: Page) => page.locator('#code');
/** The converter's form, so option names don't match the same words in the guide below it. */
const tool = (page: Page) => page.getByRole('form', { name: 'Converter' });

test.describe('the converter', () => {
  test('converts JSON to C# as you type, and follows the options', async ({ page }) => {
    await page.goto('/csharp/');
    await paste(page, '{"first_name": "Ana", "tags": ["a"]}');
    await expect(code(page)).toContainText('public class Root');
    await expect(code(page)).toContainText('[JsonPropertyName("first_name")]');
    await expect(code(page)).toContainText('public List<string> Tags { get; set; } = [];');
    await expect(page.locator('#status')).toHaveText('1 type in C#.');

    await tool(page).getByText('Records', { exact: true }).click();
    await tool(page).getByText('T[]', { exact: true }).click();
    await page.getByLabel('Attributes').selectOption('newtonsoft');
    await page.getByLabel('Namespace (optional)').fill('Shop.Models');
    await page.getByLabel('Root type name').fill('Customer');
    await expect(code(page)).toContainText('namespace Shop.Models;');
    await expect(code(page)).toContainText('public record Customer');
    await expect(code(page)).toContainText('[JsonProperty("first_name")]');
    await expect(code(page)).toContainText('public string[] Tags { get; init; } = [];');
  });

  test('converts JSON to TypeScript, and follows the options', async ({ page }) => {
    await page.goto('/typescript/');
    await paste(page, '[{"id": 1, "note": null}, {"id": 2}]');
    await expect(code(page)).toContainText('export interface Root {');
    await expect(code(page)).toContainText('note?: unknown;');
    await tool(page).getByText('Types', { exact: true }).click();
    await page.getByLabel('Read-only').check();
    await page.getByLabel('Export').uncheck();
    await expect(code(page)).toContainText('type Root = {');
    await expect(code(page)).toContainText('readonly id: number;');
    await expect(code(page)).toContainText('export {};');
  });

  test('switches language on the home page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Try a sample' }).click();
    await expect(code(page)).toContainText('public class Root');
    await tool(page).getByText('TypeScript', { exact: true }).click();
    await expect(code(page)).toContainText('export interface Root {');
    await expect(page.locator('#output-label')).toHaveText('TypeScript code');
  });

  test('shows where the JSON breaks, and keeps the last code out of date', async ({ page }) => {
    await page.goto('/csharp/');
    await paste(page, '{"a": 1}');
    await expect(code(page)).toContainText('public int A');
    await paste(page, '{\n  "a": 1\n  "b": 2\n}');
    await expect(page.locator('#error-message')).toHaveText(
      "Expected '}' or a comma after a property, found '\"' (line 3, column 3)",
    );
    await expect(page.locator('#output-label')).toHaveText('C# code (out of date)');
    await expect(page.getByRole('button', { name: 'Copy' })).toBeDisabled();
    await expect(page.locator('#input')).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Show in the JSON' }).click();
    await expect(page.locator('#input')).toBeFocused();
    expect(await page.locator('#input').evaluate((e: HTMLTextAreaElement) => e.selectionStart)).toBe(13);
  });

  test('copies and downloads the code', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions are Chromium-only in Playwright');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/typescript/');
    await paste(page, '{"a": 1}');
    await expect(code(page)).toContainText('a: number;');
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.locator('#status')).toHaveText('Copied to the clipboard.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await code(page).textContent());
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Root.ts');
  });

  test('undoes "Try a sample"', async ({ page }) => {
    await page.goto('/');
    await paste(page, '{"mine": true}');
    await page.getByRole('button', { name: 'Try a sample' }).click();
    await page.locator('#input').press('ControlOrMeta+z');
    await expect(page.locator('#input')).toHaveValue('{"mine": true}');
  });

  test('remembers the options, and the JSON only when asked', async ({ page }) => {
    await page.goto('/typescript/');
    await page.getByLabel('Read-only').check();
    await paste(page, '{"a": 1}');
    await expect(code(page)).toContainText('readonly a: number;');
    await page.reload();
    await expect(page.getByLabel('Read-only')).toBeChecked();
    await expect(page.locator('#input')).toHaveValue('');

    await page.getByLabel('Remember my JSON in this browser').check();
    await paste(page, '{"kept": 1}');
    await expect(code(page)).toContainText('kept');
    await page.reload();
    await expect(page.locator('#input')).toHaveValue('{"kept": 1}');
  });

  test("keeps each page's options when the other page is used", async ({ page }) => {
    await page.goto('/typescript/');
    await tool(page).getByText('Types', { exact: true }).click();
    await page.goto('/csharp/');
    await tool(page).getByText('Records', { exact: true }).click();
    await page.goto('/typescript/');
    await expect(page.getByLabel('Types', { exact: true })).toBeChecked();
  });

  test('stays responsive while converting a 1 MB paste', async ({ page }) => {
    await page.goto('/csharp/');
    const json = JSON.stringify(
      Array.from({ length: 9000 }, (_, i) => ({
        id: i,
        name: `item ${String(i)}`,
        price: i / 7,
        tags: ['a', 'b'],
      })),
    );
    expect(json.length).toBeGreaterThan(500_000);
    // Set the text first: laying out a large textarea is the browser's cost, not the converter's.
    await page.locator('#input').evaluate((e: HTMLTextAreaElement, text) => {
      e.value = text;
    }, json);
    await page.evaluate(() => {
      const w = window as unknown as { gaps: number[] };
      w.gaps = [];
      let last = performance.now();
      const tick = (time: number) => {
        w.gaps.push(time - last);
        last = time;
        if (w.gaps.length < 120) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      document.querySelector('#input')?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#status')).toHaveText('1 type in C#.', { timeout: 15_000 });
    const longest = await page.evaluate(() =>
      Math.max(...(window as unknown as { gaps: number[] }).gaps.slice(1)),
    );
    // The work runs in the worker; the page's frames stay short (generous for slow CI machines).
    expect(longest).toBeLessThan(250);
  });
});

test.describe('privacy', () => {
  test('the worker that sees the JSON cannot reach the network', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Try a sample' }).click();
    await expect(code(page)).toContainText('public class Root');
    const [worker] = page.workers();
    expect(worker?.url()).toMatch(/^blob:/);
    const origin = new URL(page.url()).origin;
    const result = await worker?.evaluate(
      (url) =>
        fetch(url).then(
          () => 'reached',
          () => 'blocked',
        ),
      `${origin}/favicon.svg`,
    );
    expect(result).toBe('blocked');
  });
});
