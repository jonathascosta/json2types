/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { injectPolicy } from './scripts/csp.mjs';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The policy goes into the built pages only: the dev server's live reload needs a WebSocket, which
// connect-src 'none' would block. Check policy-sensitive changes with `npm run build && npm run preview`.
function securityPolicy(): Plugin {
  return { name: 'content-security-policy', apply: 'build', transformIndexHtml: injectPolicy };
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
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] },
      },
      {
        // Needs the .NET SDK and takes a while: `npm run test:dotnet`.
        extends: true,
        test: { name: 'dotnet', include: ['scripts/**/*.dotnet.test.ts'], testTimeout: 300_000 },
      },
    ],
  },
});
