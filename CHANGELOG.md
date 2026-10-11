# Changelog

## 1.3.0 — 2026-10-11

AI that connects reliably, to more providers, and answers from your whole journal.

### Fixes

- **Azure / Foundry v1 endpoints from the page:**
  - The page built a broken URL for bases ending in `/openai/v1` (`…/openai/v1/openai/deployments/…`). It now uses the v1 route, with no API version and the deployment name in `model`.
  - The relay now defaults to the v1 API when no `DAILY_AI_API_VERSION` is set.
- **Reasoning models (`gpt-5-mini` and others):**
  - "Test link" asked for 8 tokens, which a reasoning model spends on thinking before it writes anything, so the test always came back empty. These models now get room to finish, and parameters they reject are dropped up front.
  - If a model still runs out of tokens, the request is retried with a larger budget.
- **"Local/Custom" pointed at `localhost` while the page ran on `127.0.0.1`,** so every call was cross-origin. The relay option now uses the page's own address.
- **Clearer errors:** messages that blamed CORS for every failure now name the actual cause.
- **Escaping:** provider error text is escaped before it's displayed.

### Providers

- New on the relay: **Anthropic Claude** (native Messages API, including streaming, translated for the page) and **Claude in Microsoft Foundry**. Also presets for **Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Ollama and LM Studio**.
- **Keyless Azure / Foundry:** `DAILY_AI_AUTH=entra` signs in with the Azure CLI or a service principal. The relay caches the token, refreshes it, redacts it from logs, and never sends it to the page.
- **Smarter parameter handling:** the relay recognizes reasoning models, adapts any parameter a model rejects, and retries once on 429/5xx (respecting `Retry-After`). Every adjustment is reported back in a response header.

### Studio → AI model

- **Connection:** shows how AI is connected (relay or browser), the provider, model, sign-in method and the last answer's timing and token count.
- **Run diagnostics:** checks the configuration, network, credentials and a test request one step at a time, with a specific fix for each failure.
- **List models:** shows the models the provider offers. Click one to use it.
- **Set up with the relay:** pick a provider and paste an endpoint, Target URI or just the resource name. It generates the `.env` lines (key or Entra ID) to copy. Keys are never typed into the page.
- **Provider list:** grouped by Cloud, Microsoft Azure and On this computer.
- **Browser connection:** the browser key form remains for the static host, and folds away when the relay handles AI.

### Ask your journal

- The AI console answers from **your whole journal**:
  - The search for relevant entries runs in your browser, and only the best-matching excerpts are sent.
  - Answers cite entry dates; click a citation or a source to open that entry.
- **Scope:** *Whole journal* or *This entry*.
- **Quick prompts:** This week, Open threads, Decisions, What do I know about…
- **Display:** answers stream in with basic formatting and show how many entries were sent, the time and the tokens used.
- **Ask your journal…** is also in the ✦ AI menu.
- The Intelligence button no longer covers the console's Send button.

### Tests

- New `test/test_ai.py` (9 tests): Azure v1 and classic routes, Entra ID service principal and token caching, reasoning-model adaptation and the out-of-tokens retry, Anthropic translation and streaming, diagnostics, model listing, and endpoint shapes for every preset.

## 1.2.0 — 2026-10-10

A quieter main view, a first-run introduction, and a reorganized Studio.

### Main view

- Side panels start collapsed. Closed panels show as small, faint edge tabs that reveal their name on hover or keyboard focus; `Alt+1`/`Alt+2`/`Alt+3` still open them. Panels that were open before this update are collapsed once.
- The editor toolbar fits on one row. When the column is narrow, undo/redo (still on the keyboard) and clear-formatting leave the bar. On phones the toolbar scrolls sideways instead of stacking three rows.
- While you type, the toolbar, status bar and note controls fade back; they return on hover or focus.
- *Save* is an outlined button instead of a solid one.
- Fixed a dark shadow that the closed Work, AI and Intelligence drawers cast on the right edge of the page.
- The Work panel tab and title follow the active provider (*Issues* or *Work items*).

### Introduction

- New users see a short introduction: what the app does in four steps, the key shortcuts, and whether a relay, repository or AI model is connected. Its actions are *Start writing*, *Take the full tour* (the About page) and *Settings*.
- It's shown once. People who already have entries never see it. It can be replayed from Studio → General or Studio → About.

### Studio

- Settings are grouped into *Personal*, *Intelligence*, *Connections* and *Data & system*, with a search box that finds settings by name, description or field.
- New sections:
  - **General:** name, theme, editor width and the introduction.
  - **Repository & tracking:** active provider, credential source, publish mode and capabilities, with links to the full repository settings.
  - **About:** version, mode, storage location, privacy and license.
- Every section uses the same card, row and segmented-control styles. Studio reopens on the last section you used.
- *Remove AI configuration* and *Remove repository credentials* now ask for confirmation.
- Fixed "1 entries stored".

## 1.1.0 — 2026-10-10

GitHub or Azure DevOps, chosen at runtime.

### Provider switch

- **Repository → Settings** starts with a GitHub / Azure DevOps switch. The active provider decides what you publish to, what you pull from, what the work drawer shows, which CI runs you see, and the wording and links throughout. Only that provider's settings are shown.
- Capability chips show what works on the active provider and, when something doesn't, why (relay not running, `.env` value missing, feature off).
- The ribbon badge shows **GH** or **AZ**. Click it to switch provider, publish, pull, or jump to Issues/Boards, the project board, runs, the repository or settings.
- **Mirror:** optionally push a copy to the other provider on every publish.
- New `.env` settings: `DAILY_PROVIDER`, `DAILY_PUBLISH_MODE`, `DAILY_PR_BRANCH_PREFIX`, `DAILY_MIRROR`, `DAILY_ASSETS`, `DAILY_MAX_ASSET_MB`.

### Publishing

- **Pull requests** on both providers: each entry goes on its own branch (`journal/<date>-<title>`) with one pull request; publishing again updates it. The toast and *Last publish* line link straight to it.
- **Remote-change check in relay mode** on both providers (previously GitHub in browser mode only). If the note changed in the repository since your last sync, you're asked before it's overwritten. Azure DevOps object IDs are now recorded on pull.
- **Images as files:** pasted images are committed to `<day>/assets/` and linked relatively, so the repository reads well in GitHub, Azure DevOps and Obsidian. Pulled entries show them through the relay.
- Azure DevOps publishes an entry and its images in a single push.

### GitHub Issues, Projects and Actions

- The work drawer works with **GitHub Issues** as well as Azure Boards: query, create, edit, comment, close as *Completed* or *Not planned*. Types and tags map to labels, priority to `P1`–`P4` labels, iteration to milestones, and acceptance criteria to a section in the issue body. Entry links use `#gh/<n>`.
- **Project** tab for a GitHub Projects (v2) board: Status columns, move cards, set an issue's status from its card, and add the issues linked in the current entry. A separate `DAILY_GITHUB_PROJECTS_TOKEN` supports classic tokens with the `project` scope, which personal-account projects need.
- **Actions** / **Pipelines** tab: recent runs with result, branch, commit and author. Re-run (failed jobs only when a run failed) on GitHub; queue again on Azure Pipelines.
- **Test** and **Diagnose** in relay mode now check the relay's own access to the repository and report each feature.

### Fixes

- *Publish* and the other buttons in Repository → Settings now close the Repository window.
- The Repository header updates when you switch provider.
- Phone layout: the top navigation no longer pushes the page sideways, and ribbon menus are no longer clipped.

### Tests

- 28 relay tests (12 new) covering provider routing, pull requests, change checks, images and path rules on both providers, GitHub Issues, Projects GraphQL, and Actions/Pipelines runs. A browser run checked the switch, publishing, the conflict prompt, the drawer on both providers and the phone layout.

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
