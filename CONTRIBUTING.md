# Contributing

Thanks for helping with The Daily. This page covers the setup and the few rules that keep it a dependable, single-file tool.

## Setup

```bash
git clone https://github.com/TehauD/daily.git && cd daily
npm ci                          # Node.js 20+
npx playwright install chromium # once, for the browser tests
python relay.py                 # run it: http://127.0.0.1:8000 (Python 3.9+)
```

## The rules

1. **Edit `src/`, not `public/index.html`.** Run `npm run build` and commit the regenerated `public/index.html` with your change. CI fails if they disagree.
2. **New behavior goes in `src/core/`** as TypeScript with tests. `src/legacy/` holds the original feature modules; change them only when you have to, and prefer moving logic into the core (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#migration-path)).
3. **Keep the relay dependency-free.** `relay.py` uses only Python's standard library and must run on Python 3.9.
4. **Never lose a person's words.** Anything that changes stored entries or files needs a test for the "both changed" case, and must prefer keeping data (trash, undo, review) over deleting it.
5. **Credentials never reach the page** when the relay is used, and never appear in logs, errors or exports. The relay tests check this; keep it that way.
6. **Accessibility is a requirement.** New dialogs need a label, focus management and Escape. The axe checks in `test/e2e/a11y.spec.ts` must stay clean.

## Checks

```bash
npm run check        # type-check, build up to date, unit + Express + relay tests
npm run test:e2e     # browser tests (Chromium) — starts the relay against a fake GitHub
```

| Change | Add or update |
| --- | --- |
| Core logic (merge, plans, storage) | `test/unit/*.test.ts` |
| Relay endpoints | `test/test_relay.py` (or `test/test_ai.py` for AI providers) |
| User-visible flows | `test/e2e/*.spec.ts` |

## Pull requests

- Keep commits focused, and say *why* in the message.
- Update `CHANGELOG.md` under an *Unreleased* heading, and the README if behavior or settings change.
- Describe how you tested, including anything you checked by hand.

## Reporting security issues

Please don't open a public issue; see [SECURITY.md](SECURITY.md).
