import { describe, expect, it } from 'vitest';
import { fillParts, siteHeader, toolMarkup } from './page-parts.mjs';

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
      '<body><!-- site-header --><!-- tool:typescript --><!-- site-footer --></body>',
      '/typescript/',
    );
    expect(page).not.toContain('<!--');
    expect(page).toContain('aria-current="page">JSON to TypeScript');
    expect(page).toContain('id="tool"');
    expect(page).toContain('class="site-footer"');
  });
});
