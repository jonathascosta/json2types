// The page promises that nothing pasted into it leaves the browser. This policy holds it to that:
// no requests to other origins and no network calls from scripts at all. Trusted Types make any
// string written into the DOM as HTML or script an error, so the generated code can only ever be
// shown as text; the one policy allowed, json2types-worker, vouches for the converter's worker URL
// and nothing else (src/app/app.ts). Shared by the Vite build, which writes it into every page, and by check-dist, which
// checks it is still there.
//
// default-src 'self' also covers styles: inline <style> blocks and style="" attributes are blocked.
export const contentSecurityPolicy = [
  "default-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types json2types-worker',
].join('; ');

const charset = /<meta\s+charset=["']?utf-8["']?\s*\/?>/i;

/**
 * Writes the policy into a page, right after its charset, which by convention comes first. Throws
 * rather than let a page ship without the policy.
 * @param {string} html
 * @returns {string}
 */
export function injectPolicy(html) {
  if (!charset.test(html)) throw new Error('Every page needs <meta charset="utf-8"> for the CSP');
  return html.replace(
    charset,
    (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`,
  );
}
