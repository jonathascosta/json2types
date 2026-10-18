// Checks the built site still carries its protections, in case a Vite or plugin change drops them.
// Every page: the Content Security Policy, exactly as in csp.mjs, right after the charset; no inline
// scripts or styles. Every text file: no data: URIs, which the policy doesn't allow.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentSecurityPolicy } from './csp.mjs';

const dist = 'dist';
const textFile = /\.(html|css|js|mjs|svg|txt|xml|json|webmanifest)$/;
const dataUri = /(?:\b(?:src|href|srcset)\s*=\s*["']?\s*|url\(\s*["']?\s*)data:/i;
const policyAfterCharset = new RegExp(
  `<meta\\s+charset=["']?utf-8["']?\\s*/?>\\s*<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
  'i',
);

const problems = [];
const files = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) => textFile.test(file));

for (const file of files) {
  const text = readFileSync(join(dist, file), 'utf8');
  if (dataUri.test(text)) problems.push(`${file}: contains a data: URI`);
  if (!file.endsWith('.html')) continue;

  if (!policyAfterCharset.test(text))
    problems.push(`${file}: the CSP is missing, changed or not right after the charset`);
  for (const [, attributes, body] of text.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\bsrc=/.test(attributes) || body.trim() !== '') problems.push(`${file}: has an inline script`);
  }
  if (/<style[\s>]/i.test(text)) problems.push(`${file}: has an inline <style> block`);
  if (/\sstyle\s*=/i.test(text)) problems.push(`${file}: has an inline style attribute`);
  if (/\son[a-z]+\s*=/i.test(text)) problems.push(`${file}: has an inline event handler`);
}

if (files.filter((file) => file.endsWith('.html')).length === 0) problems.push('dist/ has no pages');
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`dist/ keeps its protections (${String(files.length)} files checked)`);
