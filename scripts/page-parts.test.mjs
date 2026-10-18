import { describe, expect, it } from 'vitest';
import { fillParts, pagePath, pageParts, siteHeader, toolMarkup } from './page-parts.mjs';

describe('page parts', () => {
  it('marks the current page in the header', () => {
    expect(siteHeader('/csharp/')).toContain('<a href="/csharp/" aria-current="page">JSON to C#</a>');
    expect(siteHeader('/csharp/')).toContain('<a href="/">Home</a>');
    expect(siteHeader('/404.html')).not.toContain('aria-current');
  });

  it('gives the home page the language switch and both sets of options', () => {
    const tool = toolMarkup('any');
    expect(tool).toContain('type="radio" name="language" value="typescript"');
    expect(tool).toContain('id="csharp-options"');
    expect(tool).toContain('id="typescript-options" hidden');
  });

  it("fixes a language's own page to that language and its options", () => {
    const csharp = toolMarkup('csharp');
    expect(csharp).toContain('<input type="hidden" name="language" value="csharp" />');
    expect(csharp).not.toContain('typescript-options');
    expect(csharp).toContain('<h2 id="output-label">C# code</h2>');
    const typescript = toolMarkup('typescript');
    expect(typescript).toContain('<input type="hidden" name="language" value="typescript" />');
    expect(typescript).not.toContain('csharp-options');
    expect(typescript).toContain('id="typescript-options">');
    expect(typescript).toContain('<h2 id="output-label">TypeScript code</h2>');
  });

  it('keeps the no-script message outside the form that noscript.css hides', () => {
    expect(toolMarkup('any').indexOf('<noscript>')).toBeLessThan(toolMarkup('any').indexOf('<form'));
  });

  it('fills every marker of a page', () => {
    const page = fillParts(
      '<body><!-- site-header --><main id="main"><!--tool:typescript--></main><!--  site-footer  --></body>',
      '/typescript/',
    );
    expect(page).not.toMatch(/<!--\s*(site-|tool:)/);
    expect(page).toContain('aria-current="page">JSON to TypeScript');
    expect(page).toContain('<a class="skip-link" href="#main">');
    expect(page).toContain('<input type="hidden" name="language" value="typescript" />');
    expect(page).toContain('class="site-footer"');
  });

  it('leaves a page without a converter alone, but not one without a header or footer', () => {
    expect(fillParts('<!-- site-header --><p>404</p><!-- site-footer -->', '/404.html')).not.toContain(
      'id="tool"',
    );
    expect(() => fillParts('<p></p><!-- site-footer -->', '/x/')).toThrow('/x/: lacks <!-- site-header -->');
    expect(() => fillParts('<!-- site-header --><p></p>', '/x/')).toThrow('/x/: lacks <!-- site-footer -->');
  });

  it('refuses a converter for a language it has none for', () => {
    expect(() => fillParts('<!-- site-header --><!-- tool:java --><!-- site-footer -->', '/java/')).toThrow(
      '/java/: no converter for "java"',
    );
  });

  it('maps page files to the paths the site serves them at', () => {
    expect(pagePath('/index.html')).toBe('/');
    expect(pagePath('/csharp/index.html')).toBe('/csharp/');
    expect(pagePath('/404.html')).toBe('/404.html');
  });

  it('fills pages through the Vite plugin, by their file', () => {
    const plugin = pageParts();
    const hook = plugin.transformIndexHtml;
    if (!hook || typeof hook === 'function' || !('handler' in hook))
      throw new Error('Expected a hook object');
    const html = hook.handler.call(
      /** @type {never} */ ({}),
      '<!-- site-header --><!-- tool:csharp --><!-- site-footer -->',
      /** @type {never} */ ({ path: '/csharp/index.html', filename: 'csharp/index.html' }),
    );
    expect(html).toContain('aria-current="page">JSON to C#');
    expect(html).toContain('value="csharp"');
  });
});
