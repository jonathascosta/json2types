// The parts every page shares, written into the pages at build time (and by the dev server) where
// they hold a marker: <!-- site-header -->, <!-- tool:csharp --> (or typescript, or any for the
// page with a language switch) and <!-- site-footer -->. One copy of the converter's markup, so the
// pages can't drift apart, and no HTML is ever built from strings in the browser.

/** @typedef {'any' | 'csharp' | 'typescript'} ToolLanguage */

const NAV = [
  ['/', 'Home'],
  ['/csharp/', 'JSON to C#'],
  ['/typescript/', 'JSON to TypeScript'],
];

/** @param {string} path The page's path, to mark its link as the current page. */
export function siteHeader(path) {
  const links = NAV.map(([href, text]) =>
    href === path
      ? `<li><a href="${href}" aria-current="page">${text}</a></li>`
      : `<li><a href="${href}">${text}</a></li>`,
  ).join('\n          ');
  return `<a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <a class="brand" href="/">json2types</a>
      <nav aria-label="Pages">
        <ul>
          ${links}
        </ul>
      </nav>
    </header>`;
}

export function siteFooter() {
  return `<footer class="site-footer">
      <p>Everything runs in your browser: nothing you paste is uploaded.</p>
      <p>
        Made by <a href="https://www.jonathas.net">Jonathas Costa</a>
        <span class="version" id="version"></span>
      </p>
    </footer>`;
}

const CSHARP_OPTIONS = `<fieldset class="options" id="csharp-options">
            <legend>C# options</legend>
            <fieldset class="segmented">
              <legend>Declare</legend>
              <label><input type="radio" name="csharpKind" value="class" checked /> Classes</label>
              <label><input type="radio" name="csharpKind" value="record" /> Records</label>
            </fieldset>
            <fieldset class="segmented">
              <legend>Collections</legend>
              <label><input type="radio" name="csharpCollection" value="list" checked /> List&lt;T&gt;</label>
              <label><input type="radio" name="csharpCollection" value="array" /> T[]</label>
            </fieldset>
            <label class="field">
              Attributes
              <select name="csharpAttributes">
                <option value="systemTextJson">System.Text.Json</option>
                <option value="newtonsoft">Newtonsoft.Json</option>
                <option value="none">None</option>
              </select>
            </label>
            <label class="field">
              Namespace (optional)
              <input name="csharpNamespace" type="text" maxlength="200" autocomplete="off" spellcheck="false" />
            </label>
            <label class="check"><input type="checkbox" name="csharpNullable" checked /> Nullable reference types</label>
          </fieldset>`;

/** @param {boolean} hidden */
const typescriptOptions = (
  hidden,
) => `<fieldset class="options" id="typescript-options"${hidden ? ' hidden' : ''}>
            <legend>TypeScript options</legend>
            <fieldset class="segmented">
              <legend>Declare</legend>
              <label><input type="radio" name="tsDeclaration" value="interface" checked /> Interfaces</label>
              <label><input type="radio" name="tsDeclaration" value="type" /> Types</label>
            </fieldset>
            <label class="check"><input type="checkbox" name="tsExport" checked /> Export</label>
            <label class="check"><input type="checkbox" name="tsReadonly" /> Read-only</label>
          </fieldset>`;

const LANGUAGE_SWITCH = `<fieldset class="segmented">
            <legend>Language</legend>
            <label><input type="radio" name="language" value="csharp" checked /> C#</label>
            <label><input type="radio" name="language" value="typescript" /> TypeScript</label>
          </fieldset>`;

/**
 * The converter. On a language's own page the language is fixed (a hidden field) and only its
 * options are there; the home page has the switch and both sets of options.
 * @param {ToolLanguage} language
 */
export function toolMarkup(language) {
  const choice =
    language === 'any' ? LANGUAGE_SWITCH : `<input type="hidden" name="language" value="${language}" />`;
  const options =
    language === 'any'
      ? `${CSHARP_OPTIONS}\n\n          ${typescriptOptions(true)}`
      : language === 'csharp'
        ? CSHARP_OPTIONS
        : typescriptOptions(false);
  const outputLabel = language === 'typescript' ? 'TypeScript code' : 'C# code';
  // The privacy note and the no-script message sit outside the form, which noscript.css hides.
  return `<p class="privacy">Everything runs in your browser: nothing you paste is uploaded.</p>
      <noscript><p class="error">The converter needs JavaScript, which is turned off.</p></noscript>
      <form class="tool" id="tool" aria-label="Converter">
        <div class="settings">
          ${choice}

          <label class="field">
            Root type name
            <input name="rootName" type="text" maxlength="200" autocomplete="off" spellcheck="false" />
          </label>

          ${options}
        </div>

        <div class="panes">
          <section class="pane">
            <div class="pane-head">
              <h2 id="input-label"><label for="input">JSON</label></h2>
              <button type="button" id="sample">Try a sample</button>
              <button type="button" id="clear">Clear</button>
            </div>
            <textarea
              id="input"
              name="input"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              wrap="off"
              aria-describedby="error-message"
              placeholder='{"paste": "your JSON here"}'
            ></textarea>
            <div class="error" id="error" hidden>
              <p id="error-message"></p>
              <button type="button" id="show-error">Show in the JSON</button>
            </div>
            <label class="check"><input type="checkbox" name="rememberInput" aria-describedby="remember-note" /> Remember my JSON in this browser</label>
            <p class="hint" id="remember-note" hidden></p>
          </section>

          <section class="pane">
            <div class="pane-head">
              <h2 id="output-label">${outputLabel}</h2>
              <button type="button" id="copy" disabled>Copy</button>
              <button type="button" id="download" disabled>Download</button>
            </div>
            <pre id="output" role="region" tabindex="0" aria-labelledby="output-label"><code id="code"></code></pre>
          </section>
        </div>

        <p class="status" id="status" role="status"></p>
        <section class="notes" id="notes" aria-labelledby="notes-label" hidden>
          <h2 id="notes-label">Notes</h2>
          <ul id="notes-list"></ul>
        </section>
      </form>`;
}

const MARKER = /<!--\s*(site-header|site-footer|tool:[\w-]+)\s*-->/g;
/** @type {readonly string[]} */
const LANGUAGES = ['any', 'csharp', 'typescript'];

/**
 * Fills a page's markers. Throws on a converter marker that names no known language, and on a page
 * without its header or footer, rather than ship it without them.
 * @param {string} html
 * @param {string} path The page's path, e.g. /csharp/.
 */
export function fillParts(html, path) {
  const found = new Set();
  const filled = html.replace(MARKER, (_, /** @type {string} */ name) => {
    found.add(name);
    if (name === 'site-header') return siteHeader(path);
    if (name === 'site-footer') return siteFooter();
    const language = name.slice('tool:'.length);
    if (!LANGUAGES.includes(language)) throw new Error(`${path}: no converter for "${language}"`);
    return toolMarkup(/** @type {ToolLanguage} */ (language));
  });
  for (const part of ['site-header', 'site-footer']) {
    if (!found.has(part)) throw new Error(`${path}: lacks <!-- ${part} -->`);
  }
  return filled;
}

/**
 * The page's path for its markers: Vite names pages by file (/csharp/index.html), the site serves
 * them by folder (/csharp/).
 * @param {string} file
 */
export function pagePath(file) {
  return file.replace(/index\.html$/, '');
}

/** @returns {import('vite').Plugin} */
export function pageParts() {
  return {
    name: 'page-parts',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        return fillParts(html, pagePath(context.path));
      },
    },
  };
}
