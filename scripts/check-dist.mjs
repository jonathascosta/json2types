// Checks the built site still carries its protections, in case a Vite or plugin change drops them.
// Every page: the Content Security Policy, exactly as in csp.mjs, right after the charset; no inline
// scripts, styles or event handlers; the no-script stylesheet of the frame gate. The stylesheets:
// the frame gate's hiding rule. Every text file: no data: URIs, which the policy doesn't allow. And
// no worker served as a file of its own: it would run without the page's policy (worker-source.mjs).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentSecurityPolicy } from './csp.mjs';

const textFile = /\.(html|css|js|mjs|svg|txt|xml|json|webmanifest)$/;
const dataUri = /(?:\b(?:src|href|srcset)\s*=\s*["']?\s*|url\(\s*["']?\s*)data:/i;
const policyAfterCharset = new RegExp(
  `<meta\\s+charset=["']?utf-8["']?\\s*/?>\\s*<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
  'i',
);
// Script types that hold data, not code: the policy doesn't block them and they're safe inline.
const dataScriptType = /\btype\s*=\s*["']?application\/(?:ld\+)?json/i;
const frameGate = /body:not\(\.frame-checked\)\s*>\s*\*\s*\{[^}]*visibility:\s*hidden/;

/**
 * @param {{ name: string, text: string }[]} files The site's text files, with paths relative to dist/.
 * @returns {string[]} One line per problem found.
 */
export function findProblems(files) {
  const problems = [];
  const pages = files.filter((file) => file.name.endsWith('.html'));
  if (pages.length === 0) problems.push('dist/ has no pages');

  for (const { name, text } of files) {
    if (dataUri.test(text)) problems.push(`${name}: contains a data: URI`);
    if (/worker/i.test(name) && name.endsWith('.js')) {
      problems.push(`${name}: a worker served as its own file runs without the page's CSP`);
    }
  }

  for (const { name, text } of pages) {
    if (!policyAfterCharset.test(text)) {
      problems.push(`${name}: the CSP is missing, changed or not right after the charset`);
    }
    for (const [, attributes, body] of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (dataScriptType.test(attributes)) continue;
      if (!/\bsrc\s*=/i.test(attributes) || body.trim() !== '')
        problems.push(`${name}: has an inline script`);
    }
    // Only inside tags, so page text such as code samples ("the style = …", "const one = 1") is fine.
    if (/<style[\s>]/i.test(text)) problems.push(`${name}: has an inline <style> block`);
    if (/<[a-z][^>]*\sstyle\s*=/i.test(text)) problems.push(`${name}: has an inline style attribute`);
    if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(text)) problems.push(`${name}: has an inline event handler`);
    if (!/<noscript>\s*<link rel="stylesheet" href="\/noscript\.css"/.test(text)) {
      problems.push(`${name}: lacks the frame gate's no-script stylesheet`);
    }
  }

  const styles = files.filter((file) => file.name.endsWith('.css') && file.name !== 'noscript.css');
  if (!styles.some((file) => frameGate.test(file.text))) {
    problems.push('no stylesheet hides the page until the frame check passes (body:not(.frame-checked) > *)');
  }
  return problems;
}

/** The pages the site must have, and which of them carry the converter. */
const PAGES = [
  { name: 'index.html', tool: true, url: 'https://json2types.jonathas.net/' },
  { name: 'csharp/index.html', tool: true, url: 'https://json2types.jonathas.net/csharp/' },
  { name: 'typescript/index.html', tool: true, url: 'https://json2types.jonathas.net/typescript/' },
  { name: '404.html', tool: false, url: null },
];

/**
 * The site's own pages: each one there, with its header and footer and no marker left unfilled;
 * the converter on the pages that have it; each indexable page canonical and in the sitemap, the
 * 404 page kept out of search.
 * @param {{ name: string, text: string }[]} files
 * @returns {string[]}
 */
export function findMissingPages(files) {
  const problems = [];
  const sitemap = files.find((file) => file.name === 'sitemap.xml')?.text ?? '';
  if (sitemap === '') problems.push('dist/ has no sitemap.xml');
  for (const { name, tool, url } of PAGES) {
    const text = files.find((file) => file.name === name)?.text;
    if (text === undefined) {
      problems.push(`${name}: missing`);
      continue;
    }
    if (!text.includes('class="site-header"') || !text.includes('class="site-footer"')) {
      problems.push(`${name}: lacks the site header or footer`);
    }
    if (/<!--\s*(site-|tool:)/.test(text)) problems.push(`${name}: has an unfilled page-parts marker`);
    if (tool && !text.includes('id="tool"')) problems.push(`${name}: lacks the converter`);
    if (url === null) {
      if (!text.includes('<meta name="robots" content="noindex"'))
        problems.push(`${name}: isn't kept out of search`);
    } else {
      if (!text.includes(`<link rel="canonical" href="${url}"`))
        problems.push(`${name}: its canonical isn't ${url}`);
      if (!sitemap.includes(`<loc>${url}</loc>`)) problems.push(`${name}: ${url} isn't in sitemap.xml`);
    }
  }
  return problems;
}

/** @param {string} dist */
function readSite(dist) {
  return readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .filter((name) => textFile.test(name))
    .map((name) => ({ name, text: readFileSync(join(dist, name), 'utf8') }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readSite('dist');
  const problems = [...findProblems(files), ...findMissingPages(files)];
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`dist/ keeps its protections (${String(files.length)} files checked)`);
}
