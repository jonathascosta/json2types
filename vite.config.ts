/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The page promises that nothing pasted into it leaves the browser. This policy holds it to that:
// no requests to other origins and no network calls from scripts at all. Added to the built page
// only, because the dev server's live reload needs a WebSocket.
const contentSecurityPolicy = [
  "default-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function securityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  plugins: [securityPolicy()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    include: ['src/**/*.test.ts'],
    // The first tests arrive with the inference engine (#2).
    passWithNoTests: true,
  },
});
