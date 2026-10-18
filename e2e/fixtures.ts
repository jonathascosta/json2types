import { expect, test as base } from '@playwright/test';

/**
 * Playwright's test, failing any test whose pages throw, log an error or break the security policy:
 * with a policy this strict, a regression often shows only as a refused script or request. A test
 * that provokes errors on purpose lists the ones it expects in `expectedErrors`.
 */
export const test = base.extend<{ expectedErrors: RegExp[]; pageErrors: undefined }>({
  expectedErrors: [[], { option: true }],
  pageErrors: [
    async ({ page, expectedErrors }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      await use(undefined);
      expect(errors.filter((error) => !expectedErrors.some((expected) => expected.test(error)))).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
