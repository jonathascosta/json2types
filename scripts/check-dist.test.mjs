import { describe, expect, it } from 'vitest';
import { findMissingPages, findProblems } from './check-dist.mjs';
import { injectPolicy } from './csp.mjs';

/** @typedef {{ name: string, text: string }} SiteFile */

/** @param {string} [body] @param {string} [head] */
const page = (body = '<main><h1>json2types</h1></main>', head = '') =>
  injectPolicy(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/assets/index.css">
    <noscript><link rel="stylesheet" href="/noscript.css" /></noscript>
    <script type="module" crossorigin src="/assets/index.js"></script>${head}
  </head>
  <body>${body}</body>
</html>`);
const css = 'body:not(.frame-checked)>*{visibility:hidden;animation:reveal 0s 3s forwards}';
/** @param {string} [html] @param {SiteFile[]} [extra] @returns {SiteFile[]} */
const site = (html = page(), extra = []) => [
  { name: 'index.html', text: html },
  { name: 'assets/index.css', text: css },
  { name: 'assets/index.js', text: 'const o={data:1};document.title="x";' },
  ...extra,
];

describe('findProblems', () => {
  it('accepts a page built the way the site builds it', () => {
    expect(findProblems(site())).toEqual([]);
  });

  it('accepts code-like page text and JSON-LD', () => {
    const html = page(
      '<main><pre>const one = 1; var style = "record";</pre></main>',
      '\n    <script type="application/ld+json">{"@type":"WebApplication"}</script>',
    );
    expect(findProblems(site(html))).toEqual([]);
  });

  it('flags a missing or changed policy', () => {
    const changed = page().replace("connect-src 'none'", "connect-src 'self'");
    expect(findProblems(site(changed))).toContain(
      'index.html: the CSP is missing, changed or not right after the charset',
    );
  });

  it('flags inline scripts, styles and event handlers', () => {
    const html = page(
      '<main style="color:red" onclick="go()"><script>alert(1)</script><style>a{}</style></main>',
    );
    expect(findProblems(site(html))).toEqual([
      'index.html: has an inline script',
      'index.html: has an inline <style> block',
      'index.html: has an inline style attribute',
      'index.html: has an inline event handler',
    ]);
  });

  it('flags data: URIs in any file, but not a data key in code', () => {
    const problems = findProblems(
      site(page(), [{ name: 'noscript.css', text: 'a{background:url(data:x)}' }]),
    );
    expect(problems).toEqual(['noscript.css: contains a data: URI']);
  });

  it('flags a worker served as a file of its own', () => {
    expect(
      findProblems(site(page(), [{ name: 'assets/worker-abc123.js', text: 'onmessage=()=>{}' }])),
    ).toEqual(["assets/worker-abc123.js: a worker served as its own file runs without the page's CSP"]);
  });

  it('flags pages in subfolders too', () => {
    const problems = findProblems(
      site(page(), [{ name: 'csharp/index.html', text: '<meta charset="utf-8">' }]),
    );
    expect(problems).toContain(
      'csharp/index.html: the CSP is missing, changed or not right after the charset',
    );
  });

  it('flags a missing frame gate', () => {
    const files = site(page().replace(/<noscript>.*<\/noscript>/, '')).map((file) =>
      file.name.endsWith('.css') ? { ...file, text: 'body{margin:0}' } : file,
    );
    expect(findProblems(files)).toEqual([
      "index.html: lacks the frame gate's no-script stylesheet",
      'no stylesheet hides the page until the frame check passes (body:not(.frame-checked) > *)',
    ]);
  });
});

describe('injectPolicy', () => {
  it('puts the policy right after the charset', () => {
    expect(injectPolicy('<head><meta charset="UTF-8"><title>x</title></head>')).toMatch(
      /^<head><meta charset="UTF-8">\n {4}<meta http-equiv="Content-Security-Policy" content="default-src 'self';[^"]*" \/><title>/,
    );
  });

  it('refuses a page without a charset', () => {
    expect(() => injectPolicy('<head><title>x</title></head>')).toThrow(/charset/);
  });
});

describe('findMissingPages', () => {
  /** @param {string} name @param {string} head @param {string} body */
  const file = (name, head, body = '<form id="tool"></form>') => ({
    name,
    text: `<head>${head}</head><body><header class="site-header"></header>${body}<footer class="site-footer"></footer></body>`,
  });
  const canonical = (/** @type {string} */ path) =>
    `<link rel="canonical" href="https://json2types.jonathas.net${path}" />`;
  const sitemap = {
    name: 'sitemap.xml',
    text: ['/', '/csharp/', '/typescript/']
      .map((p) => `<loc>https://json2types.jonathas.net${p}</loc>`)
      .join(''),
  };
  const complete = () => [
    file('index.html', canonical('/')),
    file('csharp/index.html', canonical('/csharp/')),
    file('typescript/index.html', canonical('/typescript/')),
    file('404.html', '<meta name="robots" content="noindex" />', '<p>Not found</p>'),
    sitemap,
    {
      name: 'robots.txt',
      text: 'User-agent: *\nAllow: /\n\nSitemap: https://json2types.jonathas.net/sitemap.xml\n',
    },
  ];

  it('accepts the complete site', () => {
    expect(findMissingPages(complete())).toEqual([]);
  });

  it('flags a robots.txt crawlers would misread, or one without the sitemap', () => {
    const site = complete();
    site[5] = { name: 'robots.txt', text: 'User-agent *\nDisallow:' };
    expect(findMissingPages(site)).toEqual([
      'robots.txt: has a line crawlers would not understand',
      "robots.txt: doesn't point to the sitemap",
    ]);
    site[5] = {
      name: 'robots.txt',
      text: 'User-agent: *\nDisallow: /\nSitemap: https://json2types.jonathas.net/sitemap.xml',
    };
    expect(findMissingPages(site)).toEqual(['robots.txt: closes the site to crawlers']);
  });

  it('reads robots.txt as crawlers do: any case, CRLF, comments, empty Disallow, other fields', () => {
    const site = complete();
    site[5] = {
      name: 'robots.txt',
      text: '# crawl it all\r\nuser-agent: *\r\nDisallow:\r\nCrawl-delay: 1\r\nUser-agent: BadBot\r\nDisallow: /\r\nSITEMAP: https://json2types.jonathas.net/sitemap.xml\r\n',
    };
    expect(findMissingPages(site)).toEqual([]);
    expect(findMissingPages(complete().slice(0, 5))).toEqual(['dist/ has no robots.txt']);
  });

  it('flags a page the build dropped, or one without its converter, header or footer', () => {
    const site = complete().filter((f) => f.name !== 'typescript/index.html');
    site[1] = file('csharp/index.html', canonical('/csharp/'), '<p>no tool</p>');
    site[0] = { name: 'index.html', text: canonical('/') + '<form id="tool"></form>' };
    expect(findMissingPages(site)).toEqual([
      'index.html: lacks the site header or footer',
      'csharp/index.html: lacks the converter',
      'typescript/index.html: missing',
    ]);
  });

  it('flags unfilled markers, a wrong canonical, a page missing from the sitemap and an indexable 404', () => {
    const site = complete();
    site[0] = file('index.html', canonical('/'), '<form id="tool"></form><!-- tool:java -->');
    site[1] = file('csharp/index.html', canonical('/csharp'));
    site[3] = file('404.html', '', '');
    site[4] = { name: 'sitemap.xml', text: sitemap.text.replace('/typescript/', '/ts/') };
    expect(findMissingPages(site)).toEqual([
      'index.html: has an unfilled page-parts marker',
      "csharp/index.html: its canonical isn't https://json2types.jonathas.net/csharp/",
      "typescript/index.html: https://json2types.jonathas.net/typescript/ isn't in sitemap.xml",
      "404.html: isn't kept out of search",
    ]);
  });
});
