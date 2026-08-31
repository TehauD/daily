<div align="center">

# The Daily

### *Your work, your thinking — versioned.*

A calm, private, single-file **developer intelligence workspace** — a daily log where builders think, capture decisions, and version their work like code.

[![Version](https://img.shields.io/badge/version-2.0-1a4b8c)](#versioning)
[![License: MIT](https://img.shields.io/badge/license-MIT-0bb4c4)](#license)
[![Single File](https://img.shields.io/badge/build-zero--dependency-2f7dd1)](#architecture)
[![Privacy](https://img.shields.io/badge/data-100%25%20local-1c9e77)](#privacy--security)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-c98a1e)](#contributing)

*A daily writing surface on the outside. A structured capture, retrospective, and versioning engine underneath.*
*No account. No cloud required. No tracking. Just you and the day.*

</div>

---

## Table of Contents

- [Overview](#overview)
- [Why The Daily](#why-the-daily)
- [Feature Tour](#feature-tour)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Data Model](#data-model)
- [AI Integration](#ai-integration)
  - [How AI is wired in](#how-ai-is-wired-in)
  - [Provider support & endpoint resolution](#provider-support--endpoint-resolution)
  - [The seven AI surfaces](#the-seven-ai-surfaces)
  - [Voice calibration & language mirroring](#voice-calibration--language-mirroring)
  - [Fact-grounding & guardrails](#fact-grounding--guardrails)
  - [Tuning reference](#tuning-reference)
  - [AI privacy model](#ai-privacy-model)
- [Configuration](#configuration)
  - [AI Assistant](#ai-assistant)
  - [GitHub Sync](#github-sync)
  - [Azure DevOps Repos Sync](#azure-devops-repos-sync)
- [Reading Studio](#reading-studio)
- [Structured Captures](#structured-captures)
- [Browse & Constellation](#browse--constellation)
- [Export Formats](#export-formats)
- [Keyboard Shortcuts & Commands](#keyboard-shortcuts--commands)
- [Privacy & Security](#privacy--security)
- [Accessibility](#accessibility)
- [Browser Support](#browser-support)
- [Development Guide](#development-guide)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Versioning](#versioning)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Overview

**The Daily** is a **local-first developer intelligence workspace** delivered as a **single, self-contained `index.html` file**. It runs entirely in the browser with no server, no build step, and no mandatory network calls. Everything you capture lives in your own browser storage until *you* choose to export or sync it.

On the surface it is a calm, first-class **daily writing page** — a beautiful, low-friction on-ramp you *want* to return to. Underneath, it is a **structured capture, analysis, and versioning engine** built for developers and builders:

- **Capture** ideas, experiments, decisions, learnings, wins, and memories as structured, schema-backed artifacts.
- **Compound** them into pattern analysis and grounded monthly retrospectives.
- **Version** each day — and its media — to **GitHub or Azure DevOps** as clean Markdown, then explore your history as an interactive Constellation.
- **Amplify**, optionally, with AI that drafts in *your own voice* and never invents your facts.

> **Design philosophy:** The daily page is the only dominant surface. Every builder capability — structured captures, analytics, source & code management, repository sync, AI — stays exactly one click (or keystroke) away, but never competes with the blank page. *Frictionless in; powerful underneath.*

| At a glance | |
| --- | --- |
| **What it is** | Local-first developer intelligence workspace / builder's daily log |
| **Primary surface** | A calm, auto-saving daily writing page |
| **Underneath** | Structured captures · pattern analytics · retrospectives · Git versioning |
| **Audience** | Developers, builders, and like-minded thinkers |
| **Type** | Progressive, offline-first web app |
| **Footprint** | One HTML file (portable, host-anywhere) |
| **Runtime deps** | None required · `docx` (CDN) used only for Word export |
| **Storage** | `localStorage` (with in-memory fallback) |
| **Sync targets** | GitHub · Azure DevOps Repos (optional) |
| **AI** | OpenAI · Azure OpenAI · Local (Ollama / LM Studio) — all optional |
| **License** | MIT |

---

## Why The Daily

- **Built for builders.** Capture structured Ideas, Experiments, Decisions, Learnings, Wins, and Memories with rigorous, schema-backed fields — then roll them into grounded retrospectives. Your daily log becomes a searchable decision and knowledge base.
- **Versioned like code.** Sync each day (and its media) to **GitHub or Azure DevOps** as clean Markdown, then explore your history as an interactive *Constellation*. Your thinking gets the same durability as your repos.
- **Frictionless on-ramp.** The daily writing page auto-saves, auto-grows, detects pasted code and links, and never gets in your way — so capturing a thought costs nothing.
- **Truly private by default.** No sign-up, no telemetry, no cloud dependency. Nothing leaves your device unless you explicitly export or sync. Keys and tokens stay in your browser.
- **Your voice, amplified.** Optional AI drafts **from your own answers**, calibrated to your real writing style and language — it never invents your day, and it never fabricates facts in structured captures.
- **Beautiful and personal.** The *Reading Studio* lets you tune paper, typography, accent, spacing, and comfort with a live preview — a workspace you actually want to open.
- **Portable forever.** One file you can save, email, self-host, or archive. Zero lock-in.

---

## Feature Tour

### ✍️ The Writing Surface
- Distraction-light, contenteditable rich editor with **inline media** (photos embed directly in the flow of text).
- **Autosave** with a live "saving… / saved" indicator (debounced, 500 ms).
- **Auto-growing** editor that expands to fit content so nothing is pushed off-screen.
- **Slash commands** (`/`) for instant access to tools from inside the editor.
- **Daily prompts** — time-aware (morning / evening / anytime) with a one-tap "another" reroll.
- **Word count** and **read-time** estimates.

### 🤖 Compose With Me (opt-in AI)
- Conversational, interview-style drafting: the AI asks short questions, you answer (type or speak), and it weaves **your own words** into a first-person draft.
- **Voice calibration** reads snippets of your past entries to mirror your vocabulary, rhythm, register, and language.
- Draft actions: **Use**, **Append**, **Rewrite**, or continue with **more questions**.
- Additional AI helpers: **Reflection**, **Ghost autocomplete** (Tab to accept), and **Unstick**.

### 🎨 Reading Studio
- Six full **paper palettes** (Daylight, Blueprint, Parchment, Sage, Dusk, Midnight), each with light + dark variants.
- **Type pairings** (Fraunces, Newsreader, Lora, Spectral, Caveat, Inter, System).
- Fine controls: appearance mode (auto/light/dark), accent color, grain/texture, font size, line height, measure (line width), and letter spacing.
- **Live preview** card that updates as you tune.

### 🌈 Signals & Context
- **Mood** (5-point signal), **feelings** chips, **tags** (people, places, topics), **location**, and **date**.
- **Streak** tracking, **week ring**, and gentle **ritual** to "close the day."

### 📷 Photos
- Drag, paste, or pick images. **Client-side compression** (~1600px longest edge, JPEG @72%) keeps them Git-friendly.
- Photos embed inline and sync to their own files in GitHub / Azure DevOps.

### 🧠 Structured Captures & Builder Intelligence
- Six artifact types — **Idea, Experiment, Decision, Learning, Win, Memory** — each with a rigorous field schema.
- Deterministic templates *or* AI enrichment that **never invents facts**.
- **Builder Intelligence** dashboard and **monthly retrospective** generation (with optional GitHub commit).

### 🔭 Browse & Constellation
- **Timeline, Projects, Search, Briefing, Sources, and Map** hub.
- **Constellation** — a force-directed star-map of your history built from your repo: node size = words, glow = mood, image thumbnails, tag hubs, and pan/zoom.

### 📦 Export & Sync
- Export any day as **Markdown, JSON, DOCX, or Email**.
- Sync to **GitHub** and/or **Azure DevOps Repos** — journal text and embedded media pushed together.

---

## Quick Start

The Daily is a single file. There is nothing to install.

### Option 1 — Just open it
1. Download `index.html`.
2. Double-click to open it in any modern browser.
3. Start writing. That's it. Your entries autosave locally.

### Option 2 — Host it (recommended for AI + sync)
Serving over `http(s)` unlocks the most reliable behavior for clipboard, speech, and API calls.

```bash
# Python (any 3.x)
python -m http.server 8080

# Node
npx serve .

# then browse to http://localhost:8080
```

> 💡 **HTTPS note:** A page served over `https://` **cannot** call a `http://` endpoint (mixed content). If you use a **local** AI model (LM Studio / Ollama at `http://localhost`), open The Daily from a local file or a local `http://` server, not from an `https://` origin.

---

## Architecture

The Daily is intentionally a **zero-build, single-artifact** application.

```
┌──────────────────────────────────────────────────────────────┐
│                        index.html                            │
│                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────────┐  │
│  │   <style>   │   │   markup     │   │     <script>      │  │
│  │  design     │   │  semantic    │   │  application core │  │
│  │  tokens +   │   │  HTML + a11y │   │  (vanilla JS)     │  │
│  │  themes     │   │  landmarks   │   │                   │  │
│  └─────────────┘   └──────────────┘   └───────────────────┘  │
│                                                              │
│  State ── localStorage (with in-memory fallback)             │
│  Optional I/O ── fetch() → AI provider / GitHub / Azure DevOps│
│  Word export ── docx@7.1.0 (CDN, lazy)                       │
└──────────────────────────────────────────────────────────────┘
```

**Design principles**

- **Vanilla JS, no framework.** Small helper primitives (`$`, `val`, `store`, `esc`, `toast`, `status`, `download`) keep the code readable and dependency-free.
- **Theme tokens.** All visual styling is driven by CSS custom properties on `:root`; a "paper" is a complete palette applied live via `applyTheme()`.
- **Resilient storage.** The `store` wrapper transparently falls back to an in-memory map when `localStorage` is unavailable or full, and surfaces quota warnings.
- **Progressive enhancement.** Core journaling works with zero configuration; AI and sync layers activate only when you connect them.
- **Composition layer (V1).** A thin exposure layer changes *what's visible*, not *what's capable* — the command palette, day navigation, and sources/snippets/links live here.

---

## Data Model

All state is namespaced under the `thedaily:` prefix in `localStorage`.

| Key | Purpose |
| --- | --- |
| `thedaily:entry:<YYYY-MM-DD>` | One serialized journal entry per day |
| `thedaily:settings` | Reading Studio + preferences |
| `thedaily:github` | GitHub connection config |
| `thedaily:azuredevops` | Azure DevOps connection config |
| `thedaily:sync` | Active sync-target preferences |
| `thedaily:ai` | AI provider config |
| `thedaily:promptIdx` | Current daily-prompt index |
| `thedaily:constCache` | Cached parsed repo entries for Constellation |
| `thedaily:v1objects` | Sources, snippets, links, research notes |

### Entry shape

```jsonc
{
  "savedAt": "2026-08-31T16:53:00.000Z",
  "date": "2026-08-31",
  "location": "Kansas City, KS",
  "mood": 4,                         // 0–5 (0 = unset)
  "feelings": ["Calm", "Proud"],
  "entry": "Today I ... [[image:img_...]] ...",
  "grateful": "…",
  "highlight": "…",
  "intention": "…",
  "tags": ["work", "family"],
  "images": [
    {
      "id": "img_abc123",
      "name": "sunset",
      "mime": "image/jpeg",
      "dataUrl": "data:image/jpeg;base64,…",
      "w": 1600, "h": 1067, "size": 148231,
      "ghUrl": null, "ghName": null,   // set after GitHub sync
      "azPath": null, "azCommit": null, "azRepoKey": null
    }
  ]
}
```

### Synced Markdown

Each day is committed as a clean, human-readable Markdown file (`<folder>/YYYY-MM-DD.md`) that round-trips back into the Constellation via `parseEntryMarkdown()`. Photos are written to `<folder>/images/<date>/` and referenced relatively (Azure DevOps) or by raw URL (GitHub).

---

## AI Integration

AI in The Daily is **entirely optional, opt-in, and bring-your-own-endpoint**. Nothing calls a model until you connect one, and even then the app degrades gracefully — every AI feature has a deterministic, non-AI fallback. The intelligence is designed to *amplify your own thinking and words*, never to replace or fabricate them.

### How AI is wired in

All model traffic funnels through **two functions**, which keeps the integration small, auditable, and provider-agnostic:

| Function | Responsibility |
| --- | --- |
| `aiResolve()` | Inspects your saved config, detects the dialect (OpenAI / Azure / local), and returns the correct `url` + `headers`. |
| `aiChat(messages, opts)` | The single call site for every feature. Sends an OpenAI-style `messages` array, applies `temperature` / `max_tokens`, parses the response, and throws helpful errors. |

Capability is gated by `aiReady()` (true only when a base URL **and** model are configured). The UI reflects this live via `reflectAIReady()` — the `✦ AI` pill appears and `[data-ai]` buttons enable only when a model is connected. Config is persisted under `thedaily:ai` and never transmitted anywhere except your chosen endpoint.

```
 feature (Compose, Reflect, Ghost, …)
        │  builds a messages[] array
        ▼
   aiChat(messages, opts)
        │  asks aiResolve() for url + headers
        ▼
   fetch() ──► your endpoint (OpenAI · Azure · localhost)
        │
        ▼
   choices[0].message.content ──► rendered in-app
```

### Provider support & endpoint resolution

`aiResolve()` normalizes wildly different endpoint shapes so you rarely have to think about URLs:

- **OpenAI-compatible** — ensures a `/v1` suffix and appends `/chat/completions`; auth via `Authorization: Bearer <key>`. Works for OpenAI and any compatible gateway.
- **Azure OpenAI** — detected by `*.openai.azure.com` or a `/openai/deployments/` path. Builds `…/openai/deployments/<deployment>/chat/completions?api-version=<ver>` and authenticates with the `api-key` header. The **model field is your deployment name**.
- **Local (Ollama / LM Studio)** — detected by `localhost`, `127.0.0.1`, private IP ranges, or ports `1234` / `11434`. Rewrites to the server origin + `/v1`; key optional.

The **🐞 Debug** button surfaces the resolved endpoint, detected dialect, auth mode, model, and page protocol — including an explicit **mixed-content warning** when an `https://` page tries to reach an `http://` local model.

### The seven AI surfaces

Each feature builds a purpose-specific system prompt and calls the same `aiChat()` core:

| # | Surface | Function(s) | What it does |
| --- | --- | --- | --- |
| 1 | **Compose With Me** | `composeOpen` · `cxNextQuestion` · `cxGenerate` | Interviews you with short, adaptive follow-ups, then weaves *your own answers* into a first-person draft. Actions: Use / Append / Rewrite / more questions. |
| 2 | **Ghost autocomplete** | `scheduleGhost` · `acceptGhost` | Faint 4–9 word continuations in your language and voice; press `Tab` to accept. Debounced (~900 ms) and only at the end of the text. |
| 3 | **Reflection** | `aiReflect` | 2–3 warm sentences naming one feeling, one strength/win, and one gentle, non-prescriptive question. Never gives medical advice. |
| 4 | **Unstick** | `aiUnstick` | A tiny nudge — one clause or micro-question — when you stall on a blank or half-finished page. |
| 5 | **Patterns synthesis** | `aiSynthesis` | Reads up to your last **21 entries** and surfaces genuine themes, emotional trends, and one gentle observation. Never diagnoses. |
| 6 | **Structured-capture enrichment** | `capDevelop` | Turns a one-line seed into a schema-complete Idea/Experiment/Decision/etc. Returns **strict JSON** for the exact field set; marks unknowns `Pending`. |
| 7 | **Builder retrospective** | `builderRetro` | Compiles a month of structured captures into a grounded retrospective (Shipped, Ideas, Experiments, Decisions, Learnings, Open Loops, Next Focus). Optionally commits to `retrospectives/`. |

### Voice calibration & language mirroring

A shared helper, **`styleContext()`**, is appended to the system prompt of the voice-sensitive features (Compose, Ghost, Reflect, Unstick). It:

- Samples snippets of your **own recent entries** (via `recentEntryTexts()` — up to 4 entries, ~220 chars each).
- Instructs the model to **mirror your vocabulary, sentence length, punctuation habits, and level of formality**.
- Enforces **language fidelity** — it must respond in the *same language you write in* and must **not** upgrade your register (casual stays casual).

The **Compose voice** setting (`composeVoice` in the Reading Studio) lets you override this with `mine` (default, calibrated to your entries), `warm`, `brief`, or `poetic`.

### Fact-grounding & guardrails

The integration is deliberately conservative to protect the integrity of your record:

- **Never invents your day.** Compose and drafting prompts are explicitly constrained to *only* use what you supplied.
- **Never fabricates evidence.** Structured-capture enrichment (`capDevelop`) runs at **low temperature (0.2)**, must return valid JSON for the exact schema, and is told to use `Pending` for anything missing rather than inventing metrics, people, or results. Invalid JSON safely falls back to the deterministic template.
- **No medical advice / no diagnosis.** Reflection and Patterns synthesis are prompted to stay supportive and non-clinical.
- **Graceful degradation.** If AI is off or a call fails, features fall back: Compose offers a scripted question set, captures use deterministic templates, and the rest simply prompt you to connect a model.

### Tuning reference

Observed generation settings per surface (defaults: `temperature 0.8`, `max_tokens 240`):

| Surface | Temperature | Max tokens | Rationale |
| --- | :---: | :---: | --- |
| Ghost autocomplete | 0.6 | 24 | Short, safe, predictable continuations |
| Reflection | 0.6 | 200 | Warm but focused |
| Patterns synthesis | 0.6 | 280 | Grounded, specific observations |
| Compose — next question | 0.8 | 50 | Curious, varied follow-ups |
| Compose — draft | 0.7 (0.9 on rewrite) | 420 | Natural prose; more variety when rewriting |
| Capture enrichment | 0.2 | 900 | Deterministic, structured, fact-safe |
| Retrospective | 0.2 | 1400 | Long, grounded synthesis |

### AI privacy model

- **Direct-to-endpoint.** Requests go straight from your browser to the endpoint you configured — there is **no proxy or middleman**.
- **Keys stay local.** Your API key lives only in `localStorage` (`thedaily:ai`) on your device.
- **Least privilege recommended.** Prefer a **local model** or a **scoped, low-limit key**. The AI settings modal states this explicitly.
- **Test & inspect.** Use **Test link** to verify connectivity and **🐞 Debug** to see exactly where traffic will go before you send anything real.

> ⚠️ Because calls originate in the browser, your key is exposed to the page (as with any client-side app). Never embed a high-privilege production key; use a throwaway scoped key or a local model.

---

## Configuration

All configuration is stored **only in your browser** and can be cleared at any time from **Your data & local storage**.

### AI Assistant

> For the full picture — surfaces, resolution logic, guardrails, and tuning — see [**AI Integration**](#ai-integration). This is the quick **setup** reference.

The Daily speaks the **OpenAI-compatible chat completions** dialect and auto-detects Azure vs. local endpoints.

| Provider | Base URL example | Model field | Notes |
| --- | --- | --- | --- |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` | Bearer key |
| **Azure OpenAI** | `https://<resource>.openai.azure.com` | *deployment name* | Requires API version (e.g. `2024-02-15-preview`) |
| **Local** | `http://localhost:1234/v1` | *loaded model id* | Ollama / LM Studio; blank key |

**Setup steps**
1. Open the **AI Assistant** modal (`✎` / command palette → *AI settings*).
2. Pick a **provider** — the base URL and a sensible default model auto-fill.
3. Enter your **model** (or Azure **deployment name**) and **API key** (blank for local).
4. **Save**, then **Test link** to confirm. Use **🐞 Debug** to inspect the resolved endpoint before sending real data.

**LM Studio checklist:** start the **Server**, **load** the model, enable **CORS** in Server Settings, then restart. Open The Daily locally (an `https://` page can't call `http://`).

### GitHub Sync

1. Open **Sync** → **GitHub**.
2. Provide **owner/user**, **repository**, **branch** (default `main`), and **folder** (default `journal`).
3. Paste a **fine-grained Personal Access Token** scoped to **one repository** with **Contents: read and write**.
4. **Save**, then **Test**.

A single sync commits the day's Markdown plus any new embedded images via the GitHub Contents API. Existing paths are updated (SHA-aware); new paths are added.

### Azure DevOps Repos Sync

1. Open **Sync** → **Azure DevOps Repos**.
2. Provide **organization**, **project**, **repository**, **branch**, and **folder**.
3. Paste an **Azure DevOps PAT** with **Code: read & write**.
4. **Save**, then **Test**.

Azure DevOps uses the Git **Pushes** REST API to commit the journal Markdown and all new media **in a single atomic commit** against the current branch tip.

> You can enable **both** targets — The Daily fans out the sync and reports per-provider success/failure.

---

## Reading Studio

| Tab | Controls |
| --- | --- |
| **Paper** | Palette swatches, appearance mode (Auto / Light / Dark), accent color (+ custom), paper texture |
| **Type** | Writing font pairing, writing size |
| **Comfort** | Display name, line height, measure (line width), letter spacing, daily prompt toggle, ghost hints toggle, focus mode, compose voice |

Everything renders through CSS variables, so changes are instant and global. **Reset to defaults** restores the original look without touching your entries or sync config.

---

## Structured Captures

Designed for builders who want their journal to double as a decision and knowledge log.

| Type | Icon | Key fields |
| --- | --- | --- |
| **Idea** | 💡 | Problem, Why it matters, Proposed approach, Assumptions, Unknowns, Next experiment |
| **Experiment** | ⚗ | Hypothesis, Variables, Success criteria, Method, Result, Learning, Decision triggered |
| **Decision** | ◆ | Context, Decision, Alternatives, Rationale, Tradeoffs, Expected impact, Review trigger |
| **Learning** | ▣ | Topic, Insight, Evidence, Application, Open question |
| **Win** | ★ | Achievement, Impact, Who benefited, Evidence, Follow-on opportunity |
| **Memory** | ⬡ | Subject, Context, Memory, Why it matters, Use when, Sensitivity |

Each capture is emitted as a portable Markdown callout with a unique **Artifact ID**. **Builder Intelligence** aggregates counts and surfaces open (Pending) items; **Monthly Retrospective** compiles them — optionally enriched by AI that is instructed **never to invent facts** — and can be committed to `retrospectives/<YYYY-MM>.md`.

---

## Browse & Constellation

**Browse** opens a hub with six lenses:

- **Timeline** — reverse-chronological entries with word counts.
- **Projects** — tags rolled up into project views with capture counts.
- **Search** — full-text across entries, captures, code, files, and links.
- **Briefing** — days, captures, and open structured work at a glance.
- **Sources** — imported files, snippets, links (text/code indexed locally).
- **Map** — launches the Constellation.

**Constellation** reads your repository, parses each day, and lays out a **force-directed graph**: entry nodes sized by word count and colored by mood, image thumbnails hydrated on demand, and tag hubs that pull related days together. Click any star to preview it or **load it back into the editor**.

---

## Export Formats

| Format | Function | Contents |
| --- | --- | --- |
| **Markdown** | `saveJournal()` | Full day with mood, feelings, markers, tags, embedded images |
| **JSON** | `saveJournalAsJson()` | Complete structured entry object |
| **DOCX** | `saveJournalAsDocx()` | Word document with embedded, sized photos |
| **Email** | `saveJournalAsEmail()` | `mailto:` draft with a text-safe rendering |

---

## Keyboard Shortcuts & Commands

| Shortcut | Action |
| --- | --- |
| `/` (in editor) | Open slash command menu |
| `Ctrl` / `⌘` + `K` | Open the command palette |
| `Shift` + `←` / `→` | Previous / next day |
| `Tab` | Accept ghost autocomplete |
| `Esc` | Close any open modal, studio, palette, or overlay |
| `Enter` (in compose) | Send answer |

The **command palette** groups actions under **Think, Explore, Create, System** — Compose, Capture, Research, Search, Browse, Patterns, Add source, Studio, Sync, AI settings, and About.

---

## Privacy & Security

- **Local-first.** All entries and settings live in your browser's `localStorage`. Nothing is transmitted unless you export or sync.
- **Your keys, your device.** AI keys and Git tokens are stored only in your browser and sent **directly** from your device to the endpoint you configured — never to any intermediary.
- **Least privilege.** Use **fine-grained, single-repository** tokens with the minimum scopes (Contents/Code read & write). Prefer scoped, low-limit keys or a **local** model.
- **No third-party analytics or trackers.**
- **Transparent storage.** Inspect, edit, or clear every stored key from the **Your data & local storage** panel.

> ⚠️ Because this is a client-side app, anyone with access to your browser profile can read your local data. Treat exported files and tokens accordingly, and clear storage on shared machines.

---

## Accessibility

- Semantic landmarks, `aria-label`s, and `role` attributes throughout.
- Full **keyboard** operability for navigation, palette, and slash menu.
- **`prefers-reduced-motion`** honored — animations collapse gracefully.
- Visible **`:focus-visible`** outlines.
- **Print** stylesheet renders a clean, chrome-free page.
- A `<noscript>` fallback explains the JavaScript requirement.

---

## Browser Support

| Feature | Chrome | Edge | Firefox | Safari |
| --- | :---: | :---: | :---: | :---: |
| Core journaling | ✅ | ✅ | ✅ | ✅ |
| Photos / compression | ✅ | ✅ | ✅ | ✅ |
| AI / Sync (`fetch`) | ✅ | ✅ | ✅ | ✅ |
| DOCX export | ✅ | ✅ | ✅ | ✅ |
| **Dictation** (Web Speech API) | ✅ | ✅ | ⚠️ | ⚠️ |

Dictation relies on the Web Speech API and is best supported in Chromium browsers.

---

## Development Guide

The Daily is a single file, but it is organized into clearly commented sections.

**Conventions**

- Keep the app **dependency-free**; the only external script is `docx` (lazy, CDN) for Word export.
- Prefer the existing helper primitives over new abstractions.
- Style exclusively through **CSS custom properties** so themes stay consistent.
- Never introduce behavior that transmits user data without explicit user action.
- Guard optional features behind capability checks (`aiReady()`, `ghConfigured()`, `azConfigured()`).

**Local loop**

```bash
git clone <your-fork>
cd the-daily
python -m http.server 8080   # edit index.html, refresh
```

**Manual test checklist**

- [ ] Write, autosave, reload — entry persists.
- [ ] Add/paste/drag a photo — inline embed + compression toast.
- [ ] Switch days with `Shift`+`←/→` — correct entry loads.
- [ ] Studio changes apply live and survive reload.
- [ ] Export MD / JSON / DOCX / Email.
- [ ] Configure + Test AI, GitHub, and Azure DevOps.
- [ ] Sync a day, then open Constellation and confirm it appears.

---

## Project Structure

```
index.html
├── <style>        Design tokens, themes, component styles, responsive + print
├── markup
│   ├── Top bar    Brand, day lens, primary nav (Studio · Browse · Sync · About)
│   ├── Hero       Stardate, greeting, streak ribbon
│   ├── Stage      Prompt, writer (rich contenteditable), meta, capture rail,
│   │              mood, toolbar, tags, export bar
│   ├── Studio     Reading Studio drawer (Paper · Type · Comfort)
│   ├── Modals     Capture, Builder, Compose, Patterns, About, AI, Sync
│   └── Constellation  Full-screen graph + detail panel
└── <script>
    ├── Core           storage, helpers, rich media canvas
    ├── Reading Studio  palettes, pairings, theme application
    ├── Content         prompts, feelings, tags, mood, counts
    ├── Photos          compression + inline embedding
    ├── Voice/Compose   interview flow, calibration, drafting
    ├── Patterns        analytics + AI synthesis
    ├── AI              provider resolution + chat
    ├── GitHub / Azure  repository sync
    ├── Constellation   parse → graph → force layout → render
    ├── Captures        structured artifacts + retrospectives
    └── V1 layer        command palette, day nav, sources/snippets/links
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| **AI "Could not reach…"** | Local model over `http://` from an `https://` page (mixed content). Open locally; enable CORS in LM Studio and restart. |
| **GitHub 401 / 404** | Bad or unscoped token, or wrong owner/repo. Use a fine-grained token with Contents R/W on that repo. |
| **Azure "Branch not found"** | Branch name mismatch — confirm the exact branch and that the repo is initialized. |
| **DOCX export does nothing** | `docx` CDN blocked (tracking prevention). Allow `unpkg.com` or export Markdown/JSON instead. |
| **"Storage full" toast** | `localStorage` quota reached (often from many photos). Export a backup, then clear old data. |
| **Dictation unavailable** | Web Speech API needs Chrome/Edge. |

---

## Roadmap

- [ ] Optional end-to-end encryption for local storage.
- [ ] Import/restore from exported JSON and from a synced repo.
- [ ] Full-text search across the synced repository (not just local).
- [ ] Weekly/annual retrospective templates.
- [ ] PWA install + offline app shell.
- [ ] Additional export targets (PDF).

> Ideas and pull requests are welcome — see **Contributing**.

---

## Contributing

1. **Fork** and create a feature branch: `git checkout -b feature/your-idea`.
2. Keep the app **single-file** and **dependency-free**.
3. Run the **manual test checklist** above.
4. Match the existing code style and commenting conventions.
5. Open a PR with a clear description, screenshots for UI changes, and notes on privacy/security impact.

Please file bugs and feature requests as issues with reproduction steps and browser/OS details.

---

## Versioning

The Daily follows **Semantic Versioning** (`MAJOR.MINOR.PATCH`). This document describes **v2.0**. Because the app is a single file, a release is simply a tagged `index.html`.

---

## License

Released under the **MIT License** — free and open. Save it, share it, host it anywhere.

```
MIT License — © 2026 The Daily contributors
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction… (see LICENSE for full text)
```

---

## Acknowledgments

- **Typography:** Fraunces, Newsreader, Lora, Spectral, Caveat, Inter, IBM Plex Mono (Google Fonts).
- **Word export:** [`docx`](https://github.com/dolanmiu/docx).
- **Everyone who journals** — this is built so the page almost writes itself.

<div align="center">

*Write a little. Understand a lot.*

</div>
