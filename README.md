<div align="center">

# ✦ The Daily

### A calm, private, beautiful journal that almost writes itself.

*Reflective intake system · Write a little. Understand a lot.*

[![Made with HTML](https://img.shields.io/badge/Built%20with-Single%20File%20HTML-1a4b8c)](#)
[![No Backend](https://img.shields.io/badge/Backend-None-2f7dd1)](#)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-1c9e77)](#)
[![License](https://img.shields.io/badge/License-MIT-0bb4c4)](#-license)

</div>

---

## 🌅 What is The Daily?

**The Daily** is a journaling app for anyone, anywhere. It's a single HTML file — no account, no subscription, no cloud, no install. You open it and write. Everything you type lives **only in your browser** unless *you* choose to export or sync it.

It's built on one idea: **the blank page is the enemy of journaling.** So The Daily removes the friction with a mood you tap, prompts that rotate, gentle structure, an optional AI that helps you compose from *your own words*, and a quiet clinical-blue "engineering paper" aesthetic that makes you *want* to sit down and reflect.

> **Design philosophy:** the AI is a **mirror, not a ghostwriter.** It reflects you back, helps you get unstuck, and surfaces patterns across time — but the words are always yours.

---

## ✨ Features at a glance

| | Feature | What it does |
|---|---|---|
| ✎ | **Compose with me** | The AI interviews you with a few short questions, then weaves *your answers* into a first-person draft you own and edit. |
| 🎭 | **Mood signal** | Tap one of five faces — no typing required. |
| ↻ | **Adaptive prompts** | Time-aware questions (morning vs. evening) so you never face a blank page. |
| ✚ | **Sentence starters** | One click drops a natural opener where your cursor is. |
| / | **Slash commands** | Type `/` in the entry to summon every tool from a menu. |
| 🎙 | **Voice dictation** | Speak your entry hands-free (Chrome/Edge). |
| ✦ | **Ghost-text** | Optional inline AI suggestions — press **Tab** to accept. |
| ✦ | **Reflect** | A warm 2–3 sentence mirror of what you wrote. |
| ✦ | **Unstick** | A tiny nudge when the words won't come. |
| ◫ | **Patterns** | Longitudinal analysis of your history: mood charts, day-of-week trends, recurring feelings & tags, plus an optional AI synthesis. |
| 🌙 | **Close the day** | A small completion ritual with stats + an affirmation. |
| 🔥 | **Streak & week-ring** | A satisfying, guilt-free habit tracker. |
| 🎨 | **Adaptive theming** | The blue palette shifts warmth from dawn → day → dusk → night. |
| ⬇ | **Exports** | Markdown, JSON, DOCX, and Email. |
| ☁ | **GitHub Sync** | Commit each day as a Markdown file to your own repo. |
| 🔐 | **Truly private** | 100% client-side. Nothing leaves your device unless you sync/export. |

---

## 🚀 Quick start (60 seconds)

1. **Download** `index.html` from this repo.
2. **Open it** — double-click the file. It runs in any modern browser as `file://`. No server needed.
3. **Write.** Tap a mood, answer the prompt, or just start typing. It autosaves as you go.

That's it. Everything else — AI, sync, themes — is optional.

> 💡 **Want it on your phone or a URL?** See [Hosting](#-hosting-it-optional) below. It also works great as a home-screen bookmark.

---

## 📝 How to use it

### The writing canvas
- **Field 01 · Mood** — tap a face (Rough → Great). This feeds your streak and Patterns.
- **Prompt line** — a rotating question. Hit **↻ new** for another, or **↳ Prompt** to drop it into your entry.
- **The entry** — your main writing surface. It autosaves every half-second (watch the green dot).
- **Field 02 · Feelings** — tap any that fit.
- **Field 03 · Daily markers** — one line each for *Grateful for*, *Highlight*, *Intention for tomorrow*.
- **Field 04 · Tags** — type a tag and press **Enter** to index people, places, or topics.
- **Metadata** (tucked away) — change the date to revisit or backfill past days; add a location.

### Keyboard & power tips
- **`/`** → opens the slash-command menu (arrow keys to navigate, Enter to run, Esc to close).
- **Tab** → accepts an AI ghost-text suggestion when one is showing.
- **Enter** (in a tag box) → adds the tag; **Backspace** on an empty box removes the last one.
- **Esc** → closes any open modal or drawer.

### Close the day 🌙
When you're done, hit **Close the day** for a moment of completion — your word count, streak, and a gentle affirmation. It's a ritual, never a guilt trip.

---

## 🤖 Optional AI setup

AI is **entirely optional**. Without it, every non-AI feature works perfectly. With it, you unlock **Compose**, **Reflect**, **Unstick**, **ghost-text**, and **Patterns synthesis**.

The Daily talks to any **OpenAI-compatible** endpoint. Open the **✦ AI** panel and choose a provider:

### Option A — Local model (LM Studio / Ollama) 🔒 *most private*
Runs entirely on your machine — your words never leave your device.

**LM Studio:**
1. Install [LM Studio](https://lmstudio.ai), download a model, and **load** it.
2. Go to the **Developer** tab → start the **Local Server** (`Status: Running`).
3. Open **Server Settings** and **enable CORS**, then restart the server. *(This is required — the browser blocks responses without it.)*
4. In The Daily's AI panel:
   - **Provider:** `Local`
   - **Base URL:** `http://localhost:1234/v1` *(use your machine's IP if on another device, e.g. `http://192.168.1.50:1234/v1`)*
   - **Model:** the loaded model id (e.g. `openai/gpt-oss-20b`)
   - **API key:** leave **blank**
5. Click **Test link** → you should see `Link OK ✓`.

> ⚠️ **Open The Daily locally** (as `file://`). An `https://` page cannot call an `http://` local server (mixed-content block). The **🐞 Debug** button flags this and shows the exact resolved endpoint.

**Ollama:** same steps — Base URL `http://localhost:11434/v1`, model e.g. `llama3.1`, key blank. Set `OLLAMA_ORIGINS=*` to allow browser calls.

### Option B — OpenAI
- **Provider:** `OpenAI`
- **Base URL:** `https://api.openai.com/v1`
- **Model:** `gpt-4o-mini` (or your choice)
- **API key:** your `sk-…` key

### Option C — Azure OpenAI
- **Provider:** `Azure`
- **Base URL:** `https://YOUR-RESOURCE.openai.azure.com`
- **Model:** your **deployment name**
- **Azure API version:** e.g. `2024-02-15-preview`
- **API key:** your Azure key

> The app automatically handles each dialect (Azure's `api-version` + `api-key` header, local's `/v1` path, etc.).

### ✎ Compose with me — the flagship
Click **✎ Compose with me**. The AI asks a few short questions; you answer by typing or voice. When ready, hit **Draft it now** and it composes a first-person entry **from your own answers** — no invented events. Choose your **Compose voice** in Config: *Sound like me*, *Warm*, *Brief*, or *Poetic*. Then **Use**, **Append**, **Rewrite**, or ask for **more questions**.

> 🔐 **Security note:** API keys are stored **only in your browser's local storage** and calls go straight from your device to the endpoint you set. Prefer a **local model** or a **scoped, low-limit key**. For a public deployment, proxy calls through a backend so the key never touches the client.

---

## ☁️ GitHub Sync setup

Sync commits each day's entry as `journal/YYYY-MM-DD.md` to a repo you control — a durable, plain-text, portable archive of your journal.

### 1. Create a repository
Make a repo (e.g. `daily`). It can be **private**.

### 2. Create a Personal Access Token (fine-grained — recommended)
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.**
2. **Resource owner:** select **your account** (or the **org** that owns the repo).
3. **Repository access:** choose **Only select repositories** → pick your journal repo.
4. **Repository permissions:** set **Contents → Read and write.** *(This is the one that matters.)*
5. Generate and copy the token.

> If the repo lives under an **organization**, the org must **enable fine-grained tokens** (and may require approval). If in doubt, create the repo under your **personal account** — personal repo + personal token "just works."

### 3. Configure in the app
Open the **⟲ Sync** panel and enter:
- **Owner / user:** your username or org (e.g. `TehauD`)
- **Repository:** the repo name (e.g. `daily`)
- **Branch:** `main`
- **Folder:** `journal`
- **Token:** paste your PAT

Click **Test**, then **Save**. Now the **⟲ Sync** button on the main screen commits today's entry (it updates the file if you sync the same day again).

### Troubleshooting sync
| Error | Meaning | Fix |
|---|---|---|
| `403 Resource not accessible by personal access token` | Token lacks **Contents: write** or repo access | Regenerate with **Contents → Read and write** and grant the repo |
| `404 Repo not found` | Wrong owner/repo, or token can't see it | Check Owner/Repository fields; grant repo in token |
| `401 Bad credentials` | Token is wrong/expired | Paste a fresh token |
| Repos don't appear when creating the PAT | Wrong resource owner, "Only select repositories" not chosen, or repo created after the token | Pick the correct owner, select the repo, or recreate the token |

---

## 🎨 Customization (⚙ Config)

- **Theme mode:** Auto (shifts hue by time of day), Light, or Dark.
- **Text size** & **interface font.**
- **Accent color** — or leave it for the adaptive blue.
- **Writing toggles:** show/hide the daily prompt; enable/disable AI ghost hints.
- **Compose voice:** how your AI-composed drafts sound.
- **Reset:** wipe everything on this device (guarded by a confirm toggle).

---

## 🔐 Privacy & data

- **Everything is local.** Entries, settings, streak, and keys live in your browser's `localStorage`.
- **No servers, no analytics, no tracking.** The app makes network calls **only** when *you* trigger AI (to your configured endpoint) or GitHub Sync (to GitHub).
- **Your data, your control.** Export anytime (MD/JSON/DOCX/Email) or sync to your own repo.
- **The storage manager** (◈ Local data store) lets you view, edit, or clear your raw local data.

> Because it's client-side, API keys and GitHub tokens are stored in plaintext in your browser. Use scoped, low-privilege credentials — or a local model — and never commit your keys anywhere.

---

## 📁 Data formats

**Each synced/exported day is clean Markdown:**

```markdown
# 2026-08-30

**Mood:** 🙂 Good
**Feelings:** Grateful, Hopeful

Today I was building the plane while flying it...

---

◇ **Grateful for:** My wife and kids
◆ **Highlight:** Making and sharing this app with others
▷ **Tomorrow:** —
🏷 **Tags:** —

_The Daily · 8/30/2026, 8:22:47 AM_
```

**JSON export** preserves the full structured record (mood as a number, feelings/tags as arrays, timestamps) for programmatic use.

---

## 🌐 Hosting it (optional)

The Daily is one file, so hosting is trivial:

- **GitHub Pages:** put `index.html` in a repo, enable Pages → get a URL.
- **Netlify / Vercel / Cloudflare Pages:** drag-and-drop the file.
- **Local network:** serve the folder with `python -m http.server` and open it from any device.

> Remember: if you host over **https** and want to use a **local** AI model (http), open the page **locally** instead, or point the model through `localhost` on the same machine. Cloud AI (OpenAI/Azure) works fine over https.

---

## 🧭 Browser support

| Feature | Requirement |
|---|---|
| Core journaling, exports, themes, sync | Any modern browser (Chrome, Edge, Firefox, Safari) |
| **Voice dictation** | Chromium-based (Chrome/Edge) |
| **DOCX export** | Loads the `docx` library from a CDN (needs internet for that one feature) |
| **AI features** | A configured OpenAI-compatible endpoint |

---

## ❓ FAQ

**Do I need to create an account?** No. Ever.

**Does it work offline?** Yes — the app itself is fully offline. Only AI, DOCX, and GitHub Sync need a network.

**Where are my entries stored?** In your browser on this device. Switching devices/browsers won't carry them over unless you use GitHub Sync or import an export.

**Is my journal sent to any AI by default?** No. AI is off until you configure it, and even then only runs when you press an AI button.

**Can the AI write my whole entry for me?** It won't invent your day. **Compose** turns *your own answers* into prose; **Ghost-text/Unstick** offer tiny nudges. The words are yours.

**How do I move to a new computer?** Export your entries (JSON), or set up GitHub Sync and your Markdown archive travels with you.

---

## 🛠️ Under the hood

- **One file.** All HTML, CSS, and JS in `index.html`. No build step, no dependencies to install.
- **Vanilla JS.** No framework.
- **Safe by design.** Storage access is wrapped to survive private-mode/quota limits; all AI/model output is HTML-escaped before rendering; work flushes on tab close.
- **Accessible.** ARIA labels, focus-visible rings, reduced-motion support, and a print stylesheet.
- **CDN used:** only `docx` (for Word export). Fonts load from Google Fonts.

---

## 🤝 Contributing

Issues and pull requests are welcome. Because it's a single file, changes are easy to review — please keep it dependency-free and privacy-first.

Ideas that fit the spirit:
- A history/calendar view to browse past days
- "Load from GitHub" to pull entries back
- A memory layer so Compose references your recent entries
- An installable offline **PWA** wrapper

---

## 📜 License

Released under the **MIT License** — free to use, modify, host, and share. Your words belong to you.

---

<div align="center">

**The Daily** — *Capture thoughts. Build understanding.*

Made with care, so anyone on the planet can start journaling in sixty seconds.

</div>
