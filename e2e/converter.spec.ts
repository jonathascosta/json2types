import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Puts JSON in the converter's field, as typing or pasting would, and lets it convert. */
async function enter(page: Page, json: string): Promise<void> {
  await page.locator('#input').fill(json);
}

const code = (page: Page) => page.locator('#code');
/** The converter's form, so option names don't match the same words in the guide below it. */
const tool = (page: Page) => page.getByRole('form', { name: 'Converter' });

test.describe('the converter', () => {
  test('converts JSON to C# as you type, and follows every option', async ({ page }) => {
    await page.goto('/csharp/');
    await enter(page, '{"first_name": "Ana", "tags": ["a"], "note": null}');
    await expect(code(page)).toContainText('#nullable enable');
    await expect(code(page)).toContainText('public class Root');
    await expect(code(page)).toContainText('[JsonPropertyName("first_name")]');
    await expect(code(page)).toContainText('public List<string> Tags { get; set; } = [];');
    await expect(code(page)).toContainText('public object? Note { get; set; }');
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

    await page.getByLabel('Attributes').selectOption('none');
    await page.getByLabel('Nullable reference types').uncheck();
    await expect(code(page)).toContainText('#nullable disable');
    await expect(code(page)).toContainText('public string[] Tags { get; init; }\n');
    await expect(code(page)).toContainText('public object Note { get; init; }');
    await expect(code(page)).not.toContainText('[Json');
  });

  test('converts JSON to TypeScript, and follows every option', async ({ page }) => {
    await page.goto('/typescript/');
    await enter(page, '[{"id": 1, "note": null}, {"id": 2}]');
    await expect(code(page)).toContainText('export interface Root {');
    await expect(code(page)).toContainText('note?: unknown;');
    await tool(page).getByText('Types', { exact: true }).click();
    await page.getByLabel('Read-only').check();
    await page.getByLabel('Export').uncheck();
    await expect(code(page)).toContainText('type Root = {');
    await expect(code(page)).toContainText('readonly id: number;');
    await expect(code(page)).toContainText('export {};');
    await expect(code(page)).not.toContainText('export type');
  });

  test('switches language on the home page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Try a sample' }).click();
    await expect(code(page)).toContainText('public class Root');
    await tool(page).getByText('TypeScript', { exact: true }).click();
    await expect(code(page)).toContainText('export interface Root {');
    await expect(page.locator('#output-label')).toHaveText('TypeScript code');
  });

  test('lists the notes about what it inferred', async ({ page }) => {
    await page.goto('/csharp/');
    await enter(page, '{"mixed": [1, "x"], "nothing": null}');
    const notes = page.getByRole('region', { name: 'Notes' }).getByRole('listitem');
    await expect(notes).toHaveText([
      /^Warning at \$\.mixed\[\*\]: /,
      /^Note at \$\.nothing: Only null values here/,
    ]);
  });

  test('shows where the JSON breaks, and keeps the last code out of date', async ({ page }) => {
    await page.goto('/csharp/');
    await enter(page, '{"a": 1}');
    await expect(code(page)).toContainText('public int A');
    await enter(page, '{\n  "a": 1\n  "b": 2\n}');
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

  test('copies and downloads the code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/typescript/');
    await enter(page, '{"a": 1}');
    await expect(code(page)).toContainText('a: number;');
    const shown = await code(page).textContent();
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.locator('#status')).toHaveText('Copied to the clipboard.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Root.ts');
    expect(await readFile(await download.path(), 'utf8')).toBe(shown);
  });

  test('clears the JSON and the code', async ({ page }) => {
    await page.goto('/csharp/');
    await enter(page, '{"a": 1}');
    await expect(code(page)).toContainText('public int A');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('#input')).toHaveValue('');
    await expect(code(page)).toBeEmpty();
    await expect(page.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  test('undoes "Try a sample"', async ({ page }) => {
    await page.goto('/');
    await enter(page, '{"mine": true}');
    await page.getByRole('button', { name: 'Try a sample' }).click();
    await expect(page.locator('#input')).toHaveValue(/"order_id"/);
    await page.locator('#input').press('ControlOrMeta+z');
    await expect(page.locator('#input')).toHaveValue('{"mine": true}');
  });

  test('remembers the options, and the JSON only when asked', async ({ page }) => {
    await page.goto('/typescript/');
    await page.getByLabel('Read-only').check();
    await enter(page, '{"a": 1}');
    await expect(code(page)).toContainText('readonly a: number;');
    await page.reload();
    await expect(page.getByLabel('Read-only')).toBeChecked();
    await expect(page.locator('#input')).toHaveValue('');

    await page.getByLabel('Remember my JSON in this browser').check();
    await enter(page, '{"kept": 1}');
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
    await page.goto('/csharp/');
    await expect(page.getByLabel('Records', { exact: true })).toBeChecked();
  });

  test('converts a 1 MB paste in its worker, without blocking the page', async ({ page }) => {
    await page.goto('/csharp/');
    const item = (i: number) => ({
      id: i,
      name: `item ${String(i)}`,
      price: i / 7,
      tags: ['a', 'b'],
      owner: { id: i % 50, email: null, joined: '2026-10-18T12:00:00Z' },
    });
    const json = JSON.stringify(Array.from({ length: 9000 }, (_, i) => item(i)));
    expect(json.length).toBeGreaterThan(1_000_000);
    // Put the text in first: laying out a large textarea is the browser's cost, not the converter's.
    await page.locator('#input').evaluate((e: HTMLTextAreaElement, text) => {
      e.value = text;
    }, json);
    // Then convert, recording every long task on the page's own thread meanwhile.
    await page.evaluate(() => {
      const w = window as unknown as { longTasks: number[] };
      w.longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.longTasks.push(entry.duration);
      }).observe({ type: 'longtask' });
      document.querySelector('#input')?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#status')).toHaveText('2 types in C#.', { timeout: 20_000 });
    // It ran in the worker: the page has one, and did no long work of its own.
    expect(page.workers()).toHaveLength(1);
    const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
    // Generous for slow CI machines; converting this on the page itself takes far longer.
    expect(longTasks.filter((duration) => duration > 150)).toEqual([]);
  });
});

test.describe('privacy', () => {
  // The worker's refused request is reported as a policy violation: that is the point.
  test.use({ expectedErrors: [/Content Security Policy/, /Refused to connect/] });

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
