# Security Policy

## Reporting a vulnerability

Please **don't open a public GitHub issue** for security problems.

Report it privately through GitHub's **"Report a vulnerability"** button (repository → *Security* tab → *Advisories*). Please include:

- what you found and where (file, route or feature)
- steps to reproduce or a proof of concept
- the impact you expect (for example, "a crafted entry pulled from a repo can read localStorage tokens")

You'll get an acknowledgement as soon as practical. Please allow reasonable time for a fix before you disclose publicly.

## Supported versions

Only the latest commit on `main` gets security fixes.

## Scope notes

With the local relay (`relay.py`), credentials live in `.env` on the user's computer and are never sent to the browser. Without the relay, user-supplied tokens are stored in browser `localStorage` by design (see the README's *Security & privacy* section). Reports that a credential can be read *by someone who already controls the user's device or browser profile* describe expected behavior.

Especially valuable reports:

- any way for a web page, another device, or a request without the client key (when one is set) to make the relay act: push, read files, call the AI provider, or change work items
- any way to make the relay reveal a credential (`/api/config`, `/api/ai/doctor`, error messages, logs, static files), including an Entra ID access token or service-principal secret
- any way to make the journal-folder API (`/api/vault/*`) read, write or delete outside `DAILY_VAULT_DIR`, touch files other than `.md`, or overwrite a file whose version changed
- any way for the page to make the relay send AI requests or credentials to a host other than `DAILY_AI_BASE_URL` (and, for Entra sign-in, the configured authority)
- repository path escapes outside the configured `DAILY_*_ROOT`, including through the image endpoints (`/api/repositories/asset` serves only images inside `assets/` folders, with a sandbox CSP, and is the one `/api` route that skips the client key so `<img>` tags can load it; it still enforces the Host and cross-site checks)
- any way to make the work, project or run endpoints act on a repository, project or pipeline other than the configured ones
- script injection (XSS) through rendered entries, imported backups, pulled repository files, AI responses or work-item HTML
- weaknesses in the Express host's headers, the `/journal/save` gate, or the deployment workflow

## If you leaked a token

Removing it from `.env` or the browser does **not** revoke it. Revoke it at the provider straight away (GitHub → Settings → Developer settings; Azure DevOps → Personal access tokens; your AI provider's key page), then create a new one with the narrowest scope that works.
