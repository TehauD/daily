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
- any way to make the relay reveal a credential (`/api/config`, error messages, logs, static files)
- repository path escapes outside the configured `DAILY_*_ROOT`
- script injection (XSS) through rendered entries, imported backups, pulled repository files, AI responses or work-item HTML
- weaknesses in the Express host's headers, the `/journal/save` gate, or the deployment workflow

## If you leaked a token

Removing it from `.env` or the browser does **not** revoke it. Revoke it at the provider straight away (GitHub → Settings → Developer settings; Azure DevOps → Personal access tokens; your AI provider's key page), then create a new one with the narrowest scope that works.
