# Architecture

The Daily is one HTML page. This document explains how that page is built, how it starts, where it keeps data, and how it decides what changed when it syncs. Read it before changing storage, sync or start-up.

- [Build](#build)
- [Start-up](#start-up)
- [Storage](#storage)
- [The module contract](#the-module-contract)
- [Repository sync](#repository-sync)
- [The journal folder](#the-journal-folder)
- [The relay](#the-relay)
- [The hosted demo](#the-hosted-demo)
- [Migration path](#migration-path)

## Build

`scripts/build.mjs` assembles `public/index.html` from `src/`:

| Source | Becomes |
| --- | --- |
| `src/index.html` | The page shell. `<!--@include {...}-->` markers mark where each stylesheet and module goes. |
| `src/styles/NN-*.css` | A `<style>` element at its marker. Numbers keep the original cascade order. |
| `src/legacy/NN-*.js` | An inert `<script type="text/x-daily-module">` at its marker. |
| `src/core/main.ts` (and imports) | One bundled `<script id="daily-core">` at the end of the body (esbuild, IIFE, ES2020). |
| `src/about/about.html` | Base64, embedded in the app module for the About dialog. |

The output is deterministic and committed. That keeps the zero-install promise: `python relay.py`, `npm start` and opening the file all work without Node or a build step. CI runs `npm run build:check`, which fails if the committed file doesn't match `src/`.

## Start-up

```
parse HTML ─► core script runs
                │
                ├─ 1. open IndexedDB, load journal data into memory
                │     (first run: migrate from localStorage, verify, keep a backup)
                ├─ 2. publish window.DailyStore / DailySync / DailyVault
                ├─ 3. start feature modules in document order
                │     (each inert <script> is replaced by a live one;
                │      DOMContentLoaded / load are replayed if they already fired)
                ├─ 4. demo mode on non-local hosts
                └─ 5. when the relay config arrives ('daily:relay'), start the journal folder
```

Modules start only after storage is ready. That lets the long-standing synchronous `store.get/set` API be served from IndexedDB, which is asynchronous. The inline theme bootstrap in `<head>` stays synchronous and reads `daily:settings` from `localStorage` so the page never flashes the wrong theme.

## Storage

`src/core/storage/store.ts`

| Keys | Lives in | Why |
| --- | --- | --- |
| `daily:entry:*`, `daily:sha:*`, `daily:base:*`, `daily:vault:*`, `daily:trash:*` | IndexedDB (`the-daily` → `kv`), with a copy in memory | Journal data: unbounded, can be marked persistent, survives the 5 MB limit |
| everything else (`daily:settings`, provider choice, UI state) | `localStorage` | Small, read synchronously by several modules and the theme bootstrap |

- **Reads** come from memory for journal data and from `localStorage` for preferences.
- **Writes** update memory immediately. Each burst of changes is committed as one IndexedDB transaction on the next microtask, then announced on a `BroadcastChannel` so other tabs update their memory copy.
- **Failed writes** stay queued and are retried with the next change; the person sees one message.
- **Migration** runs once per database:
  1. Copy the journal keys from `localStorage`.
  2. Read them back to verify.
  3. Store a backup of the originals in the `meta` store.
  4. Only then remove them from `localStorage`.

  IndexedDB wins for any key it already has, so a stray old copy can never overwrite newer data.
- **Without IndexedDB** (some private modes) everything falls back to `localStorage`, exactly as 1.x worked.

## The module contract

The feature modules in `src/legacy/` share globals (`store`, `collect`, `buildMD`, `allEntries`…). The core talks to them through a deliberately small surface. It's typed in `src/core/bridge.ts` and published by the multi-file storage module as `window.__dailyEntries`:

```ts
all(), get(date, id), findById(id), save(entry), remove(entry),
normalize(entry), relPath(entry), serialize(entry), parse(md, date),
current(), select(date, id), refresh(id)
```

The modules call into the core through `window.DailySync` (merge, conflicts, deletes) and `window.DailyStore`. New code should go into `src/core/` and use this contract rather than more globals.

## Repository sync

`src/core/sync/`

Every entry keeps its **base**: its text as of the last successful push or pull (`daily:base:<id>`). With the base, the local text and the remote text, each sync knows what happened:

| Local vs base | Remote vs base | Result |
| --- | --- | --- |
| same | same | nothing to do |
| same | changed | take the remote text |
| changed | same | keep local; the next push publishes it |
| changed | changed | **three-way merge** (`diff3.ts`). Clean → merged text. Conflicts → the resolver dialog. |

- **On pull:** `storePulled` applies the table above. Before 2.0 a pull could silently overwrite unpushed local edits; that path is gone.
- **On push:** when the relay (or GitHub's API) reports that the remote copy changed since the recorded revision, the remote text is fetched and merged before pushing. Only real conflicts ask.
- **The resolver** (`resolver.ts`) shows each conflicting region side by side, with *Keep mine*, *Keep theirs* and *Keep both*. Bulk choices and a manual editor are also available. It's an accessible modal (focus trap, Escape, labelled radios).
- **Deletes:**
  - Deleting a note offers to delete the repository copy as well (commit or pull-request mode, both providers). The targets are captured before the note's sync metadata is removed.
  - Files that disappear from the repository are listed for review (*Remove from this browser* / *Keep them*) rather than applied silently.

The merge is line based. Adjacent edits on both sides count as a conflict, as in git; that's the conservative choice for prose.

## The journal folder

Relay endpoints: `GET /api/vault`, `GET /api/vault/list`, `GET|PUT /api/vault/file`, `POST /api/vault/delete`. Browser side: `src/core/vault/`.

**Relay guarantees**
- Paths are confined to `DAILY_VAULT_DIR` and must be `.md`. Symlink escapes are rejected, and `.trash/` and dot-folders are never touched.
- Writes are atomic (temporary file, then rename) and conditional on an **etag** (a SHA-256 prefix):

  | `ifMatch` | Meaning |
  | --- | --- |
  | `null` | The file must not exist yet |
  | an etag | The file must still be that version, or the write gets `409` with the current content |
  | `"*"` | No check |

- Deletes move the file to `.trash/<timestamp>/`.
- `.daily-vault.json` gives each folder an ID, so the app can tell a new folder from the old one.

**Browser side**

For each entry the app records `{path, rel, etag, hash, base}` from the last sync. `plan.ts` is a pure function that turns *(local entries, files on disk, recorded state)* into actions. Change-detection rules:
- **local changed:** the entry's serialized Markdown hash differs from `hash`.
- **file changed:** the file's etag differs from `etag`.

| Local | File | Action |
| --- | --- | --- |
| new | — | write (`ifMatch: null`) or adopt an existing file with the same path |
| changed | same | write (`ifMatch: etag`) |
| same | changed | pull the file into the entry |
| changed | changed | merge (base = `base`), resolver on conflict |
| renamed (title/date) | same | write the new path, move the old file to trash |
| same | missing | remove the entry (kept in `daily:trash:*` with **Undo**) |
| changed | missing | write it again |
| removed here | same | move the file to trash |
| — | unknown dated file | import it |

Safety rules:
- **Many missing files at once:** if more than three files (or 25 %) are missing in one pass, they're held for review, not deleted.
- **A new folder:** a different folder ID means the existing files are compared and adopted, never treated as deletions.
- **Postponed conflicts:** a conflict the person postpones isn't raised again until either side changes.

**Timing**
- **Local edits** are written about a second after they happen, using the recorded etag and without listing the folder.
- **Full reconciliation** runs at start-up, every 20 seconds while the page is visible, on focus, and from *Studio → Backup & export → Sync now*.
- **One tab at a time:** a Web Lock ensures only one tab syncs at once; state is shared through the store, so the others see the results.

## The relay

`relay.py` is a single standard-library Python file. Its security model is in the README (*Security & privacy → The relay*) and `SECURITY.md`. For the architecture it matters that the relay:
- serves the page,
- injects credentials,
- adapts AI requests to each provider,
- and owns the journal folder.

## The hosted demo

`src/core/demo.ts` treats any `http(s)` host that isn't local as the demo. It marks the introduction as seen, so visitors can write straight away. It also shows a dismissible note that their notes stay in the browser, and focuses the editor on devices with a fine pointer. The page and all features are otherwise identical.

## Migration path

The long-term goal is a fully typed codebase. The working rule:

1. **New behavior goes in `src/core/`** (TypeScript, unit-tested, using the bridge).
2. **A legacy module moves only when it's touched for real work.** It's rewritten as a core module behind the same DOM and global names, with tests, then deleted from `src/legacy/`.
3. **The bridge shrinks** as modules move, until the core no longer needs it.

Candidates, roughly in order of value:
- repository providers (`ghCommit`, `azCommit`, pulls), which already have typed equivalents in sync;
- the editor;
- the work drawer;
- the workspace panels.
