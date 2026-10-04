# The Daily

**A local-first developer journal for capturing where the real work happens: the dirty whiteboard, the iterative passes, the decisions you'd otherwise forget.**

The Daily is small on purpose. There is no account and no cloud backend. It keeps nothing that outlives you except what you choose to keep. Your entries live in your browser. You can push them as Markdown to a GitHub or Azure DevOps repository you control, track work in Azure Boards, and use an AI provider you choose to help curate them.

```bash
cp .env.example .env     # add your GitHub / Azure DevOps / AI settings
python relay.py          # → open http://127.0.0.1:8000
```

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Run it locally](#run-it-locally)
- [Configure `.env`](#configure-env)
  - [GitHub](#github)
  - [Azure DevOps and Boards](#azure-devops-and-boards)
  - [AI provider](#ai-provider)
  - [All settings](#all-settings)
- [Running without the relay](#running-without-the-relay)
- [Where your data lives](#where-your-data-lives)
- [Security & privacy](#security--privacy)
- [Deploying a hosted copy](#deploying-a-hosted-copy)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Project structure](#project-structure)
- [Disclaimer](#disclaimer)
- [License](#license)

---

## Features

- **Daily entries** with a rich "Canvas" editor, raw Markdown mode and a read-only view. Navigate by date and keep multiple notes per day.
- **Scaffolds and auto-tagging:** press `/` for templates (tables, callouts, checklists, code blocks). Decisions, learnings and blockers get `#type/*` tags, and `#project/...` tags group your work.
- **Browse:** Constellation graph, Timeline, Projects (by tag), Artifacts gallery and full-text Search.
- **Repository sync:** push and pull entries as Markdown to GitHub and/or Azure DevOps (`journal/YYYY/MM/DD/<title>--<id>.md`). The output works as an Obsidian vault.
- **AI assist:** "Curate today", "Find artifacts", "Discover patterns", executive summaries and status updates. Works with OpenAI, Azure OpenAI / AI Foundry, or a local model (Ollama, LM Studio).
- **Work Items:** an Azure Boards drawer that lets you link entries to work items (`#ado/123`), draft items from an entry, and update state, fields and comments.
- **Export and backup:** export one entry as `.md`, `.json` or `.html`, or back up the whole journal to one JSON file and restore it on another device.
- **Studio:** appearance (light/dark/auto, type, layout), provider settings, diagnostics console and data reset.
- **Keyboard first:** `⌘K` / `Ctrl+K` command palette, `⌘S` / `Ctrl+S` save, plus the usual formatting shortcuts.
- **No telemetry:** no third-party scripts, fonts, analytics or trackers.

## How it works

```
                 ┌──────────────────────── your browser ────────────────────────┐
                 │  The Daily (public/index.html, one self-contained page)       │
                 │  localStorage: entries + settings   (no tokens, no API keys)  │
                 └───────────────┬──────────────────────────────────────────────┘
                                 │ same-origin requests only
                 ┌───────────────▼───────────────┐      ┌──────────────────────┐
  .env ────────► │ relay.py   http://127.0.0.1:8000 ├────► │ GitHub               │
  (your secrets) │  • serves the app             │      │ Azure DevOps / Boards│
                 │  • adds credentials           │      │ AI provider          │
                 │  • guards who may call it     │      └──────────────────────┘
                 └───────────────────────────────┘
```

**`relay.py` is the recommended way to run The Daily.** It is a small Python server, using only the standard library, that runs on your computer. It serves the app and reads your tokens and keys from `.env`. It makes the GitHub, Azure DevOps and AI calls on the page's behalf. The page only ever sees non-secret settings such as your repository name and model name. Your credentials never reach the browser.

When the page loads from the relay, it detects it automatically. Any token previously typed into the browser is replaced, and work goes through the relay.

---

## Run it locally

**Prerequisites:** [Python](https://www.python.org/downloads/) 3.9 or newer, and Git. Nothing else needs installing.

```bash
git clone https://github.com/TehauD/daily.git
cd daily
cp .env.example .env                              # Windows: copy .env.example .env
```

Edit `.env` and fill in the integrations you use (see [Configure `.env`](#configure-env)). Every one of them is optional; with an empty `.env` you still get a fully working local journal.

```bash
python relay.py          # Windows: py relay.py      (or: npm run relay)
```

```
The Daily relay 1.0.0  →  http://127.0.0.1:8000
  GitHub on · Azure DevOps off · Work items off · AI on (openai) · Client key off
```

Open **http://127.0.0.1:8000**. Press `Ctrl+C` to stop the relay. Restart it after you change `.env`.

> **Use the same address every time.** Your journal is stored per address, and `127.0.0.1:8000` and `localhost:8000` count as different addresses. Pick one and bookmark it.

## Configure `.env`

`.env` is already listed in `.gitignore`, so git won't commit it. Real environment variables override values in the file, which is handy for CI or a secrets manager.

### GitHub

1. Create a **fine-grained personal access token**: GitHub → Settings → Developer settings → Fine-grained tokens.
   - **Repository access:** *Only select repositories*, and pick just your journal repo.
   - **Permissions:** *Contents: Read and write*. Leave everything else at *No access*.
   - **Expiration:** set one; 90 days is a reasonable default.
2. Fill in:

```ini
DAILY_GITHUB_TOKEN=github_pat_...
DAILY_GITHUB_OWNER=your-user-or-org
DAILY_GITHUB_REPOSITORY=your-journal-repo
DAILY_GITHUB_BRANCH=main
DAILY_GITHUB_ROOT=journal
```

The relay only reads and writes `.md` files under `DAILY_GITHUB_ROOT`.

### Azure DevOps and Boards

1. Create a PAT at User settings → Personal access tokens.
   - **Organization:** only the one you need, not "All accessible organizations".
   - **Scopes:** *Code → Read & write* for repository sync, plus *Work Items → Read & write* if you enable Boards.
2. Fill in:

```ini
DAILY_ADO_ENABLED=true
DAILY_ADO_PAT=...
DAILY_ADO_ORGANIZATION=your-org
DAILY_ADO_PROJECT=your-project
DAILY_ADO_REPOSITORY=your-repo      # leave empty for Boards only
DAILY_ADO_WIT_ENABLED=true          # turns on the Work Items drawer
```

### AI provider

| Provider | `.env` |
| --- | --- |
| **OpenAI** | `DAILY_AI_PROVIDER=openai` · `DAILY_AI_API_KEY=sk-...` · `DAILY_AI_MODEL=gpt-4o-mini` |
| **Azure OpenAI / AI Foundry** | `DAILY_AI_PROVIDER=azure` · `DAILY_AI_BASE_URL=https://<resource>.openai.azure.com` · `DAILY_AI_API_KEY=...` · `DAILY_AI_MODEL=<deployment name>` · `DAILY_AI_API_VERSION=2024-10-21` |
| **Local: Ollama / LM Studio** | `DAILY_AI_PROVIDER=compatible` · `DAILY_AI_BASE_URL=http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio) · `DAILY_AI_MODEL=llama3.1` · no key |

The relay decides which model is used and caps each request at `DAILY_AI_MAX_TOKENS`, so the page can't switch you to a more expensive model. Streaming responses are passed straight through. If a newer model rejects `max_tokens` or a custom `temperature`, the relay adjusts the request and retries once.

**What gets sent:** an AI action sends the relevant entry text, and sometimes related recent entries, to the provider you configured. That provider's data-retention policies apply. If your notes are sensitive, use a local model; then nothing leaves your machine.

### All settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `DAILY_HOST` | `127.0.0.1` | Address to listen on. Non-loopback addresses require `DAILY_CLIENT_KEY`. |
| `DAILY_PORT` | `8000` | Port. |
| `DAILY_CLIENT_KEY` | *(unset)* | Optional shared secret required on every `/api` and `/v1` call (see [Security](#the-relay)). |
| `DAILY_ALLOWED_ORIGINS` | *(unset)* | Extra browser origins allowed to call the relay, space-separated. |
| `DAILY_ALLOWED_HOSTS` | *(unset)* | Extra `Host` names to accept, e.g. a hosts-file alias. |
| `DAILY_GITHUB_*` | | `TOKEN`, `OWNER`, `REPOSITORY`, `BRANCH` (`main`), `ROOT` (`journal`). |
| `DAILY_ADO_ENABLED` | `false` | Turns on Azure DevOps. |
| `DAILY_ADO_*` | | `PAT`, `ORGANIZATION`, `PROJECT`, `REPOSITORY`, `BRANCH` (`main`), `ROOT` (`journal`). |
| `DAILY_ADO_WIT_ENABLED` | `false` | Work Items drawer. |
| `DAILY_ADO_WIT_TYPES` | `Bug,Task,User Story` | Types offered when the live list isn't available. |
| `DAILY_ADO_WIT_DEFAULT_TYPE` | first type | Default for new items. |
| `DAILY_ADO_WIT_MULTI_PROJECT` | `true` | Allow switching projects in the drawer. |
| `DAILY_ADO_WIT_PROJECTS` | *(all)* | Optional comma-separated allow-list of projects. |
| `DAILY_AI_PROVIDER` | `openai` | `openai`, `azure` or `compatible`. |
| `DAILY_AI_BASE_URL` | OpenAI's URL | Provider endpoint. |
| `DAILY_AI_API_KEY` | *(unset)* | Required for `openai` and `azure`. |
| `DAILY_AI_MODEL` | *(unset)* | Model, or deployment name on Azure. |
| `DAILY_AI_API_VERSION` | `2024-10-21` | Azure only. |
| `DAILY_AI_MAX_TOKENS` | `4000` | Upper limit per request. |
| `DAILY_MAX_BODY_MB` | `8` | Maximum request size; entries with inline images can be large. |
| `DAILY_UPSTREAM_TIMEOUT` | `60` | Seconds to wait for GitHub, Azure DevOps or the AI provider. |
| `DAILY_ENTERPRISE_ENABLED` / `_UI` | `false` | Experimental enterprise graph. Stored in `.daily-data/`. |

---

## Running without the relay

The Daily also runs as a plain static page: `npm start` (Express on port 3000) or opening `public/index.html` directly. The public hosted copy works this way. Everything works except Azure OpenAI and Work Items, which need the relay.

In this mode there's no `.env` for credentials. You enter tokens in **Repository** and **Studio → Models**, and the browser stores them for that site and calls GitHub, Azure DevOps or OpenAI directly. That is how most bring-your-own-key web tools work, and it's fine on your own computer with narrowly scoped tokens. See [Keys stored in the browser](#keys-stored-in-the-browser) for what to keep in mind.

```bash
npm ci && npm start      # http://localhost:3000  (Node.js 20+)
```

## Where your data lives

| Data | With the relay | Without the relay | In "Export entire journal"? |
| --- | --- | --- | --- |
| Journal entries | Browser `localStorage` (`daily:entry:*`) | same | ✅ Yes |
| App and appearance settings | Browser `localStorage` (`daily:settings`) | same | ✅ Yes (restore is optional) |
| GitHub / Azure DevOps tokens | **`.env` on your computer** | Browser `localStorage` (`daily:gh`, `daily:az`) | ❌ Never |
| AI key | **`.env` on your computer** | Browser `localStorage` (`daily:ai`) | ❌ Never |
| Diagnostics log | Browser `sessionStorage`, cleared when the tab closes | same | Separate export, with secrets redacted |

- Browsers allow roughly **5 MB** of storage per site, and images use it up fastest. The app warns you near the limit.
- Clearing browsing data or site data for the address **deletes your local journal**. Push to a repository or export backups regularly.
- **Studio → Advanced → Danger zone** has *Remove repository credentials* and *Delete local journal*.

---

## Security & privacy

### Security model

- **No backend database and no accounts.** Your journal lives in your browser and in the repository you choose.
- **Credentials stay on your computer.** With the relay, tokens and keys live only in `.env`. `/api/config` returns names such as owner, repo and model, never secrets. The relay never logs request bodies or headers, and it removes credential values from any error message it passes on.
- **No third-party code.** A Content-Security-Policy limits which services the page can contact and blocks other sites from embedding it.
- **Safe rendering.** Markdown links are limited to safe schemes, raw HTML in entries is escaped, and work-item HTML passes through an allow-list sanitizer.
- **Exports never contain credentials**, and the diagnostics export redacts anything that looks like a key, token, secret or password.

### The relay

The relay holds working credentials, so it only does work for the page it serves:

| Protection | What it stops |
| --- | --- |
| Listens on `127.0.0.1` only, and refuses any other address unless `DAILY_CLIENT_KEY` is set | Other devices on your network using your credentials. |
| `Host` header allow-list | DNS-rebinding attacks, where a website tricks your browser into talking to the relay. |
| Blocks cross-site browser requests (`Origin` / `Sec-Fetch-Site`) | Another website you have open quietly pushing to your repo or spending your AI quota. |
| Optional client key (`DAILY_CLIENT_KEY`) | Other programs or users on the same computer. Open the app once as `http://127.0.0.1:8000/#relay-key=<key>`; the page saves it and sends it only to the relay. |
| Repository paths confined to `DAILY_*_ROOT`, `.md` only, no `..` | Writing outside your journal folder or reading other files in the repo. |
| Model fixed by `.env`, `max_tokens` capped, unknown request fields dropped | Runaway AI costs. |
| Static files only from `public/` | Serving `.env`, `relay.py` or anything else from the project folder. |

### Looking after `.env`

- It's already in `.gitignore`. Before your first commit, `git status` should not list it.
- Don't paste it into issues or chats, and keep it out of screenshots.
- Keep it out of cloud-synced folders if you can. On macOS and Linux, restrict who can read it: `chmod 600 .env`.
- Use least-privilege tokens with expiry dates, as described above, and rotate them when they expire.
- If a token leaks, **revoke it at the provider**. Deleting it from `.env` doesn't revoke it.

### Keys stored in the browser

This only applies when you run [without the relay](#running-without-the-relay). The masked (••••) fields stop people reading the key off your screen. They are not encryption: the key is stored as plain text in your browser profile.

| Situation | Why it matters | What to do |
| --- | --- | --- |
| Shared or public computer | Keys stay saved after you close the tab. | Only connect accounts on your own device, or use the relay. |
| Other projects on the same local address | Browsers share storage by address, so other apps at `localhost:3000` can read it. | Use a dedicated port, e.g. `PORT=4517 npm start`. |
| Browser extensions you don't trust | Extensions with "read and change data on all sites" can see page storage. | Keep to trusted extensions, or use a separate browser profile. |
| Broad or non-expiring tokens | Scope decides the damage if a key leaks. | Fine-grained, single-repo tokens with an expiry, and AI keys with a spend limit. |

### Your journal content

Entries stay on your device until you **push** them to your repository or run an **AI action**. Then that provider's access controls and data policies apply. For sensitive notes, keep the repository private and use a local model.

See [CHANGELOG.md](CHANGELOG.md) for this release's security changes and [SECURITY.md](SECURITY.md) to report a vulnerability.

---

## Deploying a hosted copy

The included workflow (`.github/workflows/main_thedaily.yml`) builds and tests the app, then deploys the **static** app to the Azure App Service named `thedaily` on every push to `main`. That hosted copy runs [without the relay](#running-without-the-relay): each visitor's data and tokens stay in their own browser.

> **Never deploy `relay.py` with your `.env` to a public server.** Anyone who could reach it could push to your repository and use your AI key. The relay is designed for your own computer.

Checklist:

- [ ] **Windows App Service:** `web.config` starts the app with iisnode and routes every request through Express. In *Configuration → Path mappings*, the `/` virtual path must point to `site\wwwroot` (not `dist` or any other folder), with no other virtual directories.
- [ ] Set `NODE_ENV=production` in the App Service settings. This hides stack traces and turns on HSTS.
- [ ] Turn on **HTTPS Only**, with a minimum of TLS 1.2.
- [ ] Protect the `main` branch, since pushing to it deploys.
- [ ] Limit who can see or edit the `AZUREAPPSERVICE_*` secrets and the App Service itself.
- [ ] Add any self-hosted AI endpoint to `EXTRA_CONNECT_SRC`, and remove unused providers from `connect-src` in `app.js`.
- [ ] Keep dependencies current with `npm run audit` and Dependabot.
- [ ] Leave `JOURNAL_API_KEY` / `GITHUB_TOKEN` unset unless you need the legacy `POST /journal/save` endpoint.

## Testing

```bash
npm test                 # Node tests + relay tests
npm run test:relay       # relay only (Python, no Node needed):
python -m unittest discover -s test -p "test_*.py"
```

The relay tests run `relay.py` against a fake GitHub, Azure DevOps and OpenAI, so no real credentials or network access are needed. They cover:

- pushing, listing and reading files on both providers
- path traversal attempts
- cross-site requests, DNS rebinding, and the client key
- the AI proxy: model override, token cap, streaming and retry
- Work Items queries, creation, updates and comments
- `.env` parsing
- a check that no secret ever appears in a response or the relay's log

The Node tests cover the Express host's headers, error pages, the `/journal/save` gate and the markdown link check.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Relay prints `GitHub off` (or ADO/AI off) | A required value is missing from `.env`. GitHub needs token, owner and repository; ADO needs `DAILY_ADO_ENABLED=true` plus PAT, org and project; AI needs model, plus a key for `openai` or `azure`. Restart after editing. |
| `421 Unrecognized Host header` | You opened the relay through a name it doesn't know. Use `127.0.0.1` or `localhost`, or add the name to `DAILY_ALLOWED_HOSTS`. |
| `403 Cross-site request blocked` | The page wasn't loaded from the relay itself. Open `http://127.0.0.1:8000`, or add the other origin to `DAILY_ALLOWED_ORIGINS`. |
| `401 Missing or invalid X-Daily-Client-Key` | `DAILY_CLIENT_KEY` is set. Open `http://127.0.0.1:8000/#relay-key=<key>` once. |
| Work Items says "The relay isn't reachable" | Open the app through the relay, not from a file or `npm start`. |
| Push fails with `GitHub 403/404` | The token lacks *Contents: write*, isn't granted that repo, has expired, or owner/repo is misspelled. |
| `Azure DevOps branch 'main' not found` | Set `DAILY_ADO_BRANCH`, or push an initial commit to the repo. |
| AI returns `AI provider 401/404` | Check the key, and on Azure the deployment name (`DAILY_AI_MODEL`) and API version. |
| My entries "disappeared" | You're on a different address (`localhost` vs `127.0.0.1`, or another port, browser or profile), or site data was cleared. Use your usual address, or **Pull** from your repository. |
| `Address already in use` | Something else is on port 8000. Set `DAILY_PORT=8010`. |
| "Browser storage is full" | Export a backup, remove large images, or push to a repo and prune locally. |

## Known limitations

- **No conflict check in relay mode.** A push overwrites the remote file. Browser mode on GitHub asks first if the remote copy changed. Avoid editing the same note on two devices at once.
- **Images stay inline in relay mode.** Pasted images are committed inside the Markdown rather than as separate files under `assets/`.
- **Single user.** Sync between devices goes through your repository, and the app doesn't merge simultaneous edits.
- **Roughly 5 MB of browser storage** per address.
- **Enterprise graph is experimental** and off by default.
- The `devops/dev/*.bicep` files are empty placeholders.

## Project structure

```
.
├── relay.py                # local relay: serves the app, holds credentials from .env (stdlib only)
├── .env.example            # copy to .env and fill in; .env is git-ignored
├── public/
│   ├── index.html          # The Daily (entire client app)
│   └── stylesheets/
├── app.js, bin/www         # Express static host for the hosted copy (npm start)
├── web.config              # Windows App Service / IIS startup (iisnode → bin/www)
├── routes/journal.js       # legacy POST /journal/save (off by default)
├── views/error.ejs         # Express error page (not an app page)
├── test/
│   ├── test_relay.py       # relay end-to-end tests against fake upstreams
│   └── security.test.js    # Express host tests
├── .github/workflows/      # main_thedaily.yml (test + deploy to Azure)
├── SECURITY.md, CHANGELOG.md, LICENSE (MIT)
```

---

## Disclaimer

The Daily is a personal, open-source project provided **"as is", without warranty of any kind**, as stated in the [MIT License](LICENSE). By using it you accept that:

- **You are responsible for your own data and credentials.** That includes your `.env` file and any tokens you enter. The authors are not liable for data loss, leaked credentials, unwanted repository changes, AI usage charges, or any other damage from using this software. Keep backups.
- **It is not a secure vault.** Don't put passwords, secret keys, financial or government ID numbers, or other secrets in journal entries.
- **It is not built or certified for regulated data.** Don't record protected health information (PHI), personal data about others, or your employer's confidential or proprietary information unless you have confirmed that's allowed. The app makes no HIPAA, GDPR, SOC 2 or similar compliance claims.
- **Third-party services have their own terms.** GitHub, Azure DevOps, OpenAI, Azure OpenAI/AI Foundry and other providers' terms, pricing, retention and privacy policies apply to what you send them.
- **AI output can be wrong.** Summaries, extracted artifacts, tags, drafted work items and pattern suggestions may be incomplete, inaccurate or invented. Review them before relying on them.
- **No affiliation.** Not affiliated with or endorsed by GitHub, Microsoft, OpenAI, Obsidian or any other company named here. Trademarks belong to their owners.
- **No guarantee of availability or support.**

## License

[MIT](LICENSE) © 2025-2026 Tehau DeBarthe. You're free to use, modify and share it, including commercially; just keep the copyright and license notice.

Found a security issue? Please follow [SECURITY.md](SECURITY.md) rather than opening a public issue.
