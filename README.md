# json2types

Paste JSON, get types. A small web tool that turns a JSON sample into C# and TypeScript types,
entirely in your browser: nothing you paste is sent anywhere.

Live at [json2types.jonathas.net](https://json2types.jonathas.net) (coming soon).

The C# it writes needs C# 12 and .NET 8 or later, with System.Text.Json or Newtonsoft.Json 13.0.2
or later.
The TypeScript needs TypeScript 3.4 or later (`readonly` arrays, `unknown`).

## How it works

Three pages share one converter: `/` with a language switch, and `/csharp/` and `/typescript/`, each
fixed to its language with its own guide. The parts they share (header, converter, footer) are
written into each page at build time from `scripts/page-parts.mjs`.

The page parses and converts the JSON in a Web Worker, so a large paste doesn't freeze it, and
writes the result into the page as text. The worker is bundled into the page's script and started
from a `blob:` URL, so the page's Content Security Policy (`scripts/csp.mjs`) covers it too: no
network calls at all, from the page or the worker.

The options are remembered in the browser's `localStorage` (`json2types:settings`). The JSON is
remembered only if you tick "Remember my JSON" (`json2types:input`, up to 1 MB), and forgotten
when you untick it.

Planning lives in this repository's [issues](https://github.com/jonathascosta/json2types/issues)
and [milestones](https://github.com/jonathascosta/json2types/milestones): one milestone per sprint.

## Development

Requires Node.js 22 (22.13 or later), 24, or 26 and later. CI tests on Node 22, 24 and 26, and deploys from 24 (`.nvmrc`).

```sh
npm ci           # install
npm run dev      # local server with live reload (without the security policy)
npm test         # unit tests, and the generated TypeScript type-checked against samples
npm run test:dotnet  # compile the generated C# with the .NET 10 SDK and read samples back
npm run lint     # ESLint and Prettier
npm run build    # type-check and build to dist/
npm run preview  # serve dist/, with the security policy (no trailing-slash redirect, unlike Pages)
npm run check:dist  # check the built page keeps its security policy
npm run test:e2e    # end-to-end and accessibility tests in Chromium, against the build
npm run lighthouse  # Lighthouse on every page, phone and desktop: 95 or more in each category
```

Adding a page means adding it to `build.rolldownOptions.input` in `vite.config.ts`, to `PAGES` in
`scripts/check-dist.mjs` and to `public/sitemap.xml`, with a social image from
`design/render-images.mjs`.

## Deployment

Every pull request is linted, tested and built by GitHub Actions, and the build is checked in
Chromium (end-to-end tests, axe and Lighthouse); every push to `main` that passes is also deployed
to GitHub Pages. One-time setup, in the repository's **Settings → Pages**: set the source to
**GitHub Actions**, the custom domain to `json2types.jonathas.net`, and turn on **Enforce HTTPS**.
The DNS record is a CNAME from `json2types` to `jonathascosta.github.io`. With Actions deployments
the domain in Settings is the one that counts; `public/CNAME` only records it in the repository.

To keep anyone else from claiming the subdomain, verify `jonathas.net` once in the GitHub account's
**Settings → Pages → Verified domains**. If the site is ever retired, remove the DNS record first.
