// The page promises that nothing pasted into it leaves the browser. This policy holds it to that:
// no requests to other origins and no network calls from scripts at all. Shared by the Vite build,
// which writes it into the page, and by check-dist, which checks it is still there.
//
// default-src 'self' also covers styles: inline <style> blocks and style="" attributes are blocked.
export const contentSecurityPolicy = [
  "default-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
