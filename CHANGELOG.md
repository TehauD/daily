# Changelog

## 1.0.0 — 2026-10-04

Production-readiness release.

### Local relay (`relay.py`)

- New Python relay (standard library only) that serves the app and keeps **all credentials in `.env`**. The browser never receives a token or key.
- Implements the API the page already expects: `/api/config`, `/api/repositories/{push,files,content}` for GitHub and Azure DevOps, `/v1/chat/completions` for OpenAI, Azure OpenAI / AI Foundry and OpenAI-compatible servers (with streaming), `/api/workitems/*` for Azure Boards, and `/api/enterprise/*`, which is experimental and off by default.
- Guards: loopback-only by default (a non-loopback bind requires `DAILY_CLIENT_KEY`), `Host` allow-list against DNS rebinding, cross-site request blocking, optional client key, repository paths confined to the journal root, model fixed by `.env`, token cap, no secrets in responses, logs or errors.
- The page now prefers the relay's settings. Tokens previously typed into the browser are replaced with a credential-free marker, and stale markers are cleared when the relay isn't present. Same-origin relay calls automatically carry the optional client key, which can be set by opening `/#relay-key=<key>` once.
- `.env.example` documents every setting. `.gitignore` also ignores `.daily-data/` and Python caches.
- `npm run relay` and `npm run test:relay`. `npm test` now runs both suites: 16 relay tests against fake upstreams and 7 Express tests.

### Security and reliability

- Removed a startup line that **printed `GITHUB_TOKEN` to the server log**.
- `POST /journal/save` previously let **anyone who could reach the server write files into your GitHub repo**, and it accepted unvalidated paths. It is now disabled unless `JOURNAL_API_KEY` is set, requires a bearer key (constant-time comparison), validates `date` as `YYYY-MM-DD`, caps content size and no longer returns upstream error details.
- The markdown renderer now allows only `http(s):`, `mailto:` and relative links (plus `data:image/*` / `blob:` for images). This blocks `javascript:` links in entries, pulled files and AI output.
- Added security headers: Content-Security-Policy (`frame-ancestors 'none'`, `object-src 'none'`, restricted `connect-src`), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, and HSTS in production. Also removed `X-Powered-By`.
- Error pages no longer show stack traces outside development, and 5xx messages are generic in production.
- Request bodies are limited to 1 MB.
- Dependencies: fixed the out-of-sync lockfile (`npm ci` failed before) and updated `morgan`, `path-to-regexp`, `qs` and other transitive packages. `npm audit` reports **0 vulnerabilities**.
- Added `/healthz`, an `engines` field, `.env.example`, and a test suite (`npm test`).
- License remains **MIT**; copyright year updated to 2025-2026 and `package.json` declares `"license": "MIT"`.
- Removed unused images `public/self.png` (2.3 MB) and `public/td-logo-white.png`.
- Removed `npm-publish.yml` (the project is private and is not published to npm).
- Removed `main_veritas.yml`, which deployed this repo to the portfolio App Service (`veritas`) and failed for lack of that repo's secrets. `main_thedaily.yml` is the deploy workflow; it now uses `npm ci`, an audit gate, `setup-node@v4` and Python for the relay tests.
- Added `web.config` for Windows App Service (iisnode → `bin/www`, every request routed through Express) and removed the empty `server.js`, which Azure could have picked as the startup file.
- Removed the unused `/users` placeholder route and the Express starter page (`views/index.ejs`, `routes/index.js`). `public/index.html` is now the only app page.

### Docs

- New README with local setup, configuration, security model, deployment checklist and disclaimer.
- Added `SECURITY.md` and `.env.example`.
