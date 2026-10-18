/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { contentSecurityPolicy } from './scripts/csp.mjs';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function securityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    // Placed right after the charset, which by convention comes first. Fails the build rather than
    // ship a page without the policy.
    transformIndexHtml: (html) => {
      const charset = /<meta\s+charset=["']?utf-8["']?\s*\/?>/i;
      if (!charset.test(html)) throw new Error('Every page needs <meta charset="utf-8"> for the CSP');
      return html.replace(
        charset,
        (tag) =>
          `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [securityPolicy()],
  build: {
    // Keep every asset a file of its own: the policy above has no data: sources.
    assetsInlineLimit: 0,
    // The polyfill loads modules with fetch(), which connect-src 'none' blocks; every browser the
    // site supports has native modulepreload.
    modulePreload: { polyfill: false },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    include: ['src/**/*.test.ts'],
    // The first tests arrive with the inference engine (#2).
    passWithNoTests: true,
  },
});
