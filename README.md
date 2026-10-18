# json2types

Paste JSON, get types. A small web tool that turns a JSON sample into C# and TypeScript types,
entirely in your browser: nothing you paste is sent anywhere.

Live at [json2types.jonathas.net](https://json2types.jonathas.net) (coming soon).

The C# it writes needs C# 12 and .NET 8 or later, with System.Text.Json or Newtonsoft.Json 13.0.2
or later.

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
npm run preview  # serve dist/, with the security policy
npm run check:dist  # check the built page keeps its security policy
```

## Deployment

Every pull request is linted, tested and built by GitHub Actions; every push to `main` is also
deployed to GitHub Pages. One-time setup, in the repository's **Settings → Pages**: set the source to
**GitHub Actions**, the custom domain to `json2types.jonathas.net`, and turn on **Enforce HTTPS**.
The DNS record is a CNAME from `json2types` to `jonathascosta.github.io`. With Actions deployments
the domain in Settings is the one that counts; `public/CNAME` only records it in the repository.

To keep anyone else from claiming the subdomain, verify `jonathas.net` once in the GitHub account's
**Settings → Pages → Verified domains**. If the site is ever retired, remove the DNS record first.
