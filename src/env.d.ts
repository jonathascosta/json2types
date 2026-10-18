/** The version in package.json, injected at build time. */
declare const __APP_VERSION__: string;

/** Trusted Types, which TypeScript's DOM library doesn't declare yet; only what the page uses. */
interface TrustedScriptURL {
  toString(): string;
}
interface Window {
  readonly trustedTypes?: {
    createPolicy(
      name: string,
      rules: { createScriptURL(url: string): string },
    ): { createScriptURL(url: string): TrustedScriptURL };
  };
}

/** The converter's worker, bundled as text (scripts/worker-source.mjs). */
declare module 'virtual:converter-worker' {
  const source: string;
  export default source;
}
