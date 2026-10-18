// Checks the built page still carries its protections, in case a Vite or plugin change drops them:
// the Content Security Policy meta tag, no inline scripts and no data: URIs.
import { readdirSync, readFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const problems = [];

if (!/<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'none'/.test(html)) {
  problems.push('dist/index.html has no Content Security Policy with connect-src none');
}
for (const [, attributes, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=/.test(attributes) || body.trim() !== '') problems.push('dist/index.html has an inline script');
}
for (const file of ['index.html', ...readdirSync('dist/assets').map((name) => `assets/${name}`)]) {
  if (readFileSync(`dist/${file}`, 'utf8').includes('data:'))
    problems.push(`dist/${file} contains a data: URI`);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('dist/ keeps its protections');
