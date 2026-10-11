#!/usr/bin/env python3
"""
The Daily — local relay.

Serves the journal (public/index.html) and keeps every credential on the server
side, loaded from a local .env file. The browser never receives a token or key.

    python relay.py            # then open http://127.0.0.1:8000

What it does
  * GET  /                                   the app (static files from ./public)
  * GET  /healthz                            liveness + which integrations are on
  * GET  /api/config                         non-secret config the page uses to switch into relay mode
  * POST /api/repositories/push              commit an entry to GitHub and/or Azure DevOps
  * GET  /api/repositories/files             list journal Markdown files
  * GET  /api/repositories/content           read one journal file
  * POST /v1/chat/completions                AI proxy (OpenAI, Azure OpenAI / AI Foundry, or any OpenAI-compatible server)
  * /api/workitems/*                         Azure DevOps Boards (optional)
  * /api/enterprise/*                        local enterprise graph store (optional, feature-flagged)

Security model (see README → "Running with the relay")
  * Listens on 127.0.0.1 by default. Binding to another interface requires DAILY_CLIENT_KEY.
  * Host-header allow-list (blocks DNS-rebinding attacks).
  * Rejects cross-site browser requests (Origin / Sec-Fetch-Site), so other websites
    you visit can't make the relay push to your repo or spend your AI quota.
  * Optional shared client key (X-Daily-Client-Key) for every /api and /v1 call.
  * Secrets are never returned, logged, or echoed in error messages.
  * Repository paths are confined to the configured root folder and must be .md files.

Requires Python 3.9+. No third-party packages.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
from html import unescape as html_unescape
import ipaddress
import json
import mimetypes
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "2.0.0"
HERE = Path(__file__).resolve().parent


# --------------------------------------------------------------------------- .env

def load_dotenv(path: Path) -> None:
    """Minimal .env loader. Real environment variables win over the file."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        elif val.startswith("#"):
            val = ""  # KEY=   # comment  → empty
        else:
            val = re.split(r"\s+#", val, maxsplit=1)[0].strip()  # '#' inside a value is kept
        os.environ.setdefault(key, val)


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def env_bool(name: str, default: bool = False) -> bool:
    v = env(name)
    if not v:
        return default
    return v.lower() in ("1", "true", "yes", "on")


def env_int(name: str, default: int) -> int:
    try:
        return int(env(name) or default)
    except ValueError:
        return default


def clean_root(p: str) -> str:
    return "/".join(s for s in p.replace("\\", "/").split("/") if s and s not in (".", ".."))


# --------------------------------------------------------------------------- AI providers
# name: (default base URL, display label, wire format)
AI_PRESETS = {
    "openai": ("https://api.openai.com/v1", "OpenAI", "openai"),
    "azure": ("", "Azure OpenAI / Microsoft Foundry", "azure"),
    "anthropic": ("https://api.anthropic.com", "Anthropic Claude", "anthropic"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", "Google Gemini", "openai"),
    "openrouter": ("https://openrouter.ai/api/v1", "OpenRouter", "openai"),
    "groq": ("https://api.groq.com/openai/v1", "Groq", "openai"),
    "mistral": ("https://api.mistral.ai/v1", "Mistral", "openai"),
    "deepseek": ("https://api.deepseek.com/v1", "DeepSeek", "openai"),
    "xai": ("https://api.x.ai/v1", "xAI Grok", "openai"),
    "together": ("https://api.together.xyz/v1", "Together AI", "openai"),
    "ollama": ("http://localhost:11434/v1", "Ollama (local)", "openai"),
    "lmstudio": ("http://localhost:1234/v1", "LM Studio (local)", "openai"),
    "compatible": ("", "OpenAI-compatible server", "openai"),
}
AI_ALIASES = {"foundry": "azure", "azure-openai": "azure", "azureopenai": "azure", "ai-foundry": "azure",
              "claude": "anthropic", "foundry-claude": "anthropic", "azure-anthropic": "anthropic",
              "google": "gemini", "lm-studio": "lmstudio", "grok": "xai", "local": "compatible", "custom": "compatible"}
AI_NEEDS_KEY = {"openai": True, "azure": True, "anthropic": True, "gemini": True, "openrouter": True, "groq": True,
                "mistral": True, "deepseek": True, "xai": True, "together": True}
AZURE_HOST = re.compile(r"\.(openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com|"
                        r"inference\.ai\.azure\.com|models\.ai\.azure\.com)$", re.I)



class Settings:
    def __init__(self) -> None:
        self.host = env("DAILY_HOST", "127.0.0.1")
        self.port = env_int("DAILY_PORT", 8000)
        self.static_dir = (HERE / env("DAILY_STATIC_DIR", "public")).resolve()
        self.client_key = env("DAILY_CLIENT_KEY")
        self.allowed_origins = {o.rstrip("/") for o in env("DAILY_ALLOWED_ORIGINS").split() if o}
        self.extra_hosts = {h.lower() for h in env("DAILY_ALLOWED_HOSTS").split() if h}
        self.max_body = env_int("DAILY_MAX_BODY_MB", 8) * 1024 * 1024
        self.timeout = env_int("DAILY_UPSTREAM_TIMEOUT", 60)

        # GitHub
        self.gh_token = env("DAILY_GITHUB_TOKEN")
        self.gh_owner = env("DAILY_GITHUB_OWNER")
        self.gh_repo = env("DAILY_GITHUB_REPOSITORY")
        self.gh_branch = env("DAILY_GITHUB_BRANCH", "main")
        self.gh_root = clean_root(env("DAILY_GITHUB_ROOT", "journal"))
        self.gh_api = env("DAILY_GITHUB_API_URL", "https://api.github.com").rstrip("/")
        self.gh_enabled = env_bool("DAILY_GITHUB_ENABLED", True) and all(
            (self.gh_token, self.gh_owner, self.gh_repo))
        self.gh_graphql = env("DAILY_GITHUB_GRAPHQL_URL", self.gh_api + "/graphql")
        self.gh_issues = self.gh_enabled and env_bool("DAILY_GITHUB_ISSUES_ENABLED", True)
        self.gh_issue_types = [t.strip() for t in env("DAILY_GITHUB_ISSUE_TYPES", "Bug,Task,Feature").split(",") if t.strip()]
        self.gh_actions = self.gh_enabled and env_bool("DAILY_GITHUB_ACTIONS_ENABLED", True)
        self.gh_project_owner = env("DAILY_GITHUB_PROJECT_OWNER", self.gh_owner)
        self.gh_project_number = env_int("DAILY_GITHUB_PROJECT_NUMBER", 0)
        self.gh_project_field = env("DAILY_GITHUB_PROJECT_STATUS_FIELD", "Status")
        self.gh_projects_token = env("DAILY_GITHUB_PROJECTS_TOKEN") or self.gh_token
        self.gh_projects = self.gh_issues and self.gh_project_number > 0

        # Azure DevOps (repos + boards share org + PAT)
        self.ado_pat = env("DAILY_ADO_PAT")
        self.ado_org = env("DAILY_ADO_ORGANIZATION")
        self.ado_project = env("DAILY_ADO_PROJECT")
        self.ado_repo = env("DAILY_ADO_REPOSITORY")
        self.ado_branch = env("DAILY_ADO_BRANCH", "main")
        self.ado_root = clean_root(env("DAILY_ADO_ROOT", "journal"))
        self.ado_api = env("DAILY_ADO_API_URL", "https://dev.azure.com").rstrip("/")
        ado_on = env_bool("DAILY_ADO_ENABLED") and bool(self.ado_pat and self.ado_org and self.ado_project)
        self.ado_enabled = ado_on and bool(self.ado_repo)
        self.wit_enabled = ado_on and env_bool("DAILY_ADO_WIT_ENABLED")
        self.wit_types = [t.strip() for t in env("DAILY_ADO_WIT_TYPES", "Bug,Task,User Story").split(",") if t.strip()]
        self.wit_default_type = env("DAILY_ADO_WIT_DEFAULT_TYPE", self.wit_types[0] if self.wit_types else "Task")
        self.wit_multi_project = env_bool("DAILY_ADO_WIT_MULTI_PROJECT", True)
        self.wit_projects = [p.strip() for p in env("DAILY_ADO_WIT_PROJECTS").split(",") if p.strip()]
        self.ado_pipelines = ado_on and env_bool("DAILY_ADO_PIPELINES_ENABLED", True)
        self.ado_web = env("DAILY_ADO_WEB_URL", "https://dev.azure.com").rstrip("/")

        # Publishing: which provider is primary, mirroring, commit vs pull request, image assets
        avail = [p for p, ok in (("github", self.gh_enabled), ("ado", self.ado_enabled or self.wit_enabled)) if ok]
        want = env("DAILY_PROVIDER").lower().replace("azure", "ado").replace("azuredevops", "ado")
        self.provider_default = want if want in avail else (avail[0] if avail else (want or "github"))
        self.providers = avail
        self.mirror = env_bool("DAILY_MIRROR", False)
        mode = env("DAILY_PUBLISH_MODE", "commit").lower()
        self.publish_mode = mode if mode in ("commit", "pr") else "commit"
        self.pr_prefix = clean_root(env("DAILY_PR_BRANCH_PREFIX", "journal")) or "journal"
        self.assets = env_bool("DAILY_ASSETS", True)
        self.max_asset = env_int("DAILY_MAX_ASSET_MB", 10) * 1024 * 1024

        # AI — see AI_PRESETS for the providers the relay knows by name
        prov = env("DAILY_AI_PROVIDER", "openai").lower().strip()
        prov = AI_ALIASES.get(prov, prov)
        if prov not in AI_PRESETS:
            prov = "compatible"
        self.ai_provider = prov
        preset_base, self.ai_label, kind = AI_PRESETS[prov]
        self.ai_base = env("DAILY_AI_BASE_URL", preset_base).rstrip("/")
        host = (urllib.parse.urlsplit(self.ai_base).hostname or "").lower()
        if prov == "anthropic" or "/anthropic" in self.ai_base or host == "api.anthropic.com":
            kind = "anthropic"
        elif prov == "azure" or (prov == "compatible" and AZURE_HOST.search(host)):
            kind = "azure"
        self.ai_kind = kind                                    # openai | azure | anthropic
        self.ai_azure_hosted = bool(AZURE_HOST.search(host))
        if kind == "anthropic" and self.ai_azure_hosted:
            self.ai_label = "Claude in Microsoft Foundry"
        self.ai_key = env("DAILY_AI_API_KEY")
        self.ai_model = env("DAILY_AI_MODEL")
        self.ai_version = env("DAILY_AI_API_VERSION")          # Azure only; empty = v1 API (no version)
        self.ai_max_tokens = env_int("DAILY_AI_MAX_TOKENS", 4000)
        auth = env("DAILY_AI_AUTH", "key").lower()
        self.ai_auth = "entra" if auth in ("entra", "entra-id", "aad", "azure-ad", "keyless") else "key"
        self.ai_entra_scope = env("DAILY_AI_ENTRA_SCOPE", "https://ai.azure.com/.default")
        self.ai_tenant = env("DAILY_AI_TENANT_ID")
        self.ai_client_id = env("DAILY_AI_CLIENT_ID")
        self.ai_client_secret = env("DAILY_AI_CLIENT_SECRET")
        self.ai_authority = env("DAILY_AI_AUTHORITY", "https://login.microsoftonline.com").rstrip("/")
        r = env("DAILY_AI_REASONING", "auto").lower()
        self.ai_reasoning = r if r in ("auto", "on", "off") else "auto"
        self.ai_effort = env("DAILY_AI_REASONING_EFFORT").lower()
        self.ai_reasoning_floor = min(env_int("DAILY_AI_REASONING_MIN_TOKENS", 1024), self.ai_max_tokens)
        needs_key = AI_NEEDS_KEY.get(prov, False) and self.ai_auth != "entra"
        missing = []
        if not self.ai_base:
            missing.append("DAILY_AI_BASE_URL")
        if not self.ai_model:
            missing.append("DAILY_AI_MODEL")
        if needs_key and not self.ai_key:
            missing.append("DAILY_AI_API_KEY")
        self.ai_missing = missing
        self.ai_enabled = env_bool("DAILY_AI_ENABLED", True) and not missing

        # Journal folder ("vault"): entries mirrored as Markdown files on this computer
        self.vault_enabled = env_bool("DAILY_VAULT", True)
        vd = os.path.expanduser(env("DAILY_VAULT_DIR", "vault"))
        self.vault_dir = (Path(vd) if os.path.isabs(vd) else HERE / vd).resolve()

        # Enterprise (experimental)
        self.ent_enabled = env_bool("DAILY_ENTERPRISE_ENABLED")
        self.ent_ui = self.ent_enabled and env_bool("DAILY_ENTERPRISE_UI")
        self.data_dir = (HERE / env("DAILY_DATA_DIR", ".daily-data")).resolve()

    def secrets(self) -> list[str]:
        extra = [_ENTRA["token"]] if "_ENTRA" in globals() and _ENTRA.get("token") else []
        return [s for s in (self.gh_token, self.gh_projects_token, self.ado_pat, self.ai_key, self.ai_client_secret,
                            self.client_key, *extra) if s]


S: Settings  # set in main()


# --------------------------------------------------------------------------- helpers

class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def redact(text: str) -> str:
    for s in S.secrets():
        if len(s) >= 6:
            text = text.replace(s, "[REDACTED]")
    return text


def upstream(method: str, url: str, headers: dict | None = None, body=None, *, raw: bool = False,
             content_type: str = "application/json"):
    """Call an upstream API. Returns parsed JSON (or bytes when raw=True)."""
    data = None
    hdrs = {"User-Agent": f"the-daily-relay/{VERSION}", "Accept": "application/json"}
    hdrs.update(headers or {})
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        hdrs["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=S.timeout) as r:
            payload = r.read()
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            j = json.loads(e.read() or b"{}")
            detail = j.get("message") or (j.get("error") or {}).get("message") or ""
        except Exception:  # noqa: BLE001
            pass
        raise HttpError(e.code, redact(f"Upstream {e.code}" + (f": {detail[:200]}" if detail else ""))) from None
    except urllib.error.URLError as e:
        raise HttpError(502, f"Upstream unreachable: {e.reason}") from None
    if raw:
        return payload
    return json.loads(payload or b"{}")


# Repository paths: relative, .md, safe characters, no traversal.
SEG_RE = re.compile(r"^[A-Za-z0-9._@()+\- ]{1,120}$")


def safe_rel_path(p: str) -> str:
    parts = [s for s in str(p or "").replace("\\", "/").split("/") if s]
    if not parts or len(parts) > 12:
        raise HttpError(400, "Invalid path")
    for s in parts:
        if s in (".", "..") or not SEG_RE.match(s):
            raise HttpError(400, "Invalid path")
    if not parts[-1].lower().endswith(".md"):
        raise HttpError(400, "Only .md files can be written")
    return "/".join(parts)


def under_root(path: str, root: str) -> str:
    rel = safe_rel_path(path.lstrip("/"))
    if root and not (rel == root or rel.startswith(root + "/")):
        raise HttpError(403, "Path is outside the journal folder")
    return rel


DATED = re.compile(r"(?:^|/)\d{4}/\d{2}/\d{2}/|\d{4}-\d{2}-\d{2}\.md$", re.I)


def q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


def qpath(p: str) -> str:
    return "/".join(q(x) for x in p.split("/"))


# --------------------------------------------------------------------------- publishing helpers

class Conflict(HttpError):
    pass


def check_conflict(mode: str, opts: dict, current) -> None:
    """Refuse to overwrite a file that changed remotely since this browser last synced it."""
    known = (opts.get("knownSha") or "").strip()
    if mode != "pr" and known and current and current != known and not opts.get("force"):
        raise Conflict(409, "REMOTE_CHANGED: this note changed in the repository since your last sync")


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def pr_branch(rel: str) -> str:
    """journal/2026-10-10-my-note--abc123 for journal 2026/10/10/my-note--abc123.md"""
    parts = rel.split("/")
    stem = re.sub(r"\.md$", "", parts[-1], flags=re.I)
    date = "-".join(p for p in parts[:-1] if p.isdigit())
    name = re.sub(r"[^a-z0-9-]+", "-", f"{date}-{stem}".lower()).strip("-")
    name = re.sub(r"-{3,}", "--", name)[:80].strip("-") or "entry"
    return f"{S.pr_prefix}/{name}"


def pr_body(opts: dict) -> str:
    lines = ["Published from **The Daily** for review."]
    if opts.get("date"):
        lines.append(f"\n- Entry date: {opts['date']}")
    if opts.get("summary"):
        lines.append(f"\n> {str(opts['summary'])[:600]}")
    lines.append("\nMerge to add this note to the journal.")
    return "\n".join(lines)


DATA_IMG = re.compile(r"!\[([^\]]*)\]\((data:image/(png|jpe?g|gif|webp|svg\+xml|avif|bmp);base64,([A-Za-z0-9+/=\s]+))\)")
ASSET_URL = re.compile(r"\]\(/api/repositories/asset\?provider=\w+&path=([^)\s]+)\)")


def externalize_assets(md: str, rel: str):
    """Move pasted data: images into assets/ next to the note and link them relatively."""
    folder = rel.rsplit("/", 1)[0] if "/" in rel else ""
    stem = re.sub(r"\.md$", "", rel.rsplit("/", 1)[-1], flags=re.I)[:60]
    seen, assets = {}, []

    def repl(m):
        uri = m.group(2)
        if uri not in seen:
            data = base64.b64decode(re.sub(r"\s", "", m.group(4)))
            if len(data) > S.max_asset:
                raise HttpError(413, f"An image is larger than {S.max_asset // 1048576} MB")
            ext = {"jpeg": "jpg", "svg+xml": "svg"}.get(m.group(3), m.group(3))
            name = f"{stem}-{len(assets) + 1}.{ext}"
            assets.append({"rel": (folder + "/" if folder else "") + "assets/" + name, "data": data, "name": name})
            seen[uri] = "assets/" + name
        return f"![{m.group(1)}]({seen[uri]})"

    return DATA_IMG.sub(repl, md), assets


def rewrite_assets(md: str, provider: str, note_path: str) -> str:
    """On pull: point relative assets/ links at the relay so images display in the app."""
    folder = note_path.strip("/").rsplit("/", 1)[0]

    def repl(m):
        target = m.group(2)
        if re.match(r"^[a-z][a-z0-9+.-]*:|^/", target, re.I):
            return m.group(0)
        full = "/".join(p for p in (folder + "/" + target).split("/") if p and p != ".")
        return f"![{m.group(1)}](/api/repositories/asset?provider={provider}&path={q(full)})"

    return re.sub(r"!\[([^\]]*)\]\(((?:\./)?assets/[^)\s]+)\)", repl, md)


def unrewrite_assets(md: str) -> str:
    """On push: turn relay asset URLs back into relative assets/ links."""
    return ASSET_URL.sub(lambda m: "](assets/" + urllib.parse.unquote(m.group(1)).rsplit("/", 1)[-1] + ")", md)


ASSET_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
               "svg": "image/svg+xml", "avif": "image/avif", "bmp": "image/bmp"}


def asset_rel(path: str, root: str) -> str:
    parts = [x for x in urllib.parse.unquote(path).replace("\\", "/").split("/") if x]
    if not parts or any(x in (".", "..") or not SEG_RE.match(x) for x in parts) or "assets" not in parts[:-1]:
        raise HttpError(400, "Invalid asset path")
    rel = "/".join(parts)
    if root and not rel.startswith(root + "/"):
        raise HttpError(403, "Path is outside the journal folder")
    ext = parts[-1].rsplit(".", 1)[-1].lower()
    if ext not in ASSET_TYPES:
        raise HttpError(400, "Not an image")
    return rel


# --------------------------------------------------------------------------- GitHub

def gh_headers() -> dict:
    return {"Authorization": f"Bearer {S.gh_token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"}


def gh_base() -> str:
    return f"{S.gh_api}/repos/{q(S.gh_owner)}/{q(S.gh_repo)}"


def gh_ref_sha(branch: str):
    """Commit sha at the tip of a branch, or None if the branch doesn't exist."""
    try:
        j = upstream("GET", f"{gh_base()}/git/ref/heads/{qpath(branch)}", gh_headers())
    except HttpError as e:
        if e.status == 404:
            return None
        raise
    return (j.get("object") or {}).get("sha")


def gh_file_sha(path: str, ref: str):
    try:
        return upstream("GET", f"{gh_base()}/contents/{qpath(path)}?ref={q(ref)}", gh_headers()).get("sha")
    except HttpError as e:
        if e.status == 404:
            return None
        raise


def gh_put(path: str, data: bytes, message: str, branch: str, sha=None) -> dict:
    body = {"message": message, "content": base64.b64encode(data).decode(), "branch": branch}
    if sha:
        body["sha"] = sha
    return upstream("PUT", f"{gh_base()}/contents/{qpath(path)}", gh_headers(), body)


def gh_open_pr(branch: str, title: str, body: str) -> dict:
    try:
        j = upstream("POST", f"{gh_base()}/pulls", gh_headers(),
                     {"title": title, "head": branch, "base": S.gh_branch, "body": body})
        return {"number": j.get("number"), "url": j.get("html_url", ""), "existing": False}
    except HttpError as e:
        if e.status != 422:
            raise
        lst = upstream("GET", f"{gh_base()}/pulls?state=open&head={q(S.gh_owner + ':' + branch)}", gh_headers())
        if isinstance(lst, list) and lst:
            return {"number": lst[0].get("number"), "url": lst[0].get("html_url", ""), "existing": True}
        raise HttpError(422, "GitHub would not open a pull request (no changes compared with the base branch?)") from None


def gh_push(rel: str, markdown: str, message: str, opts: dict | None = None) -> dict:
    opts = opts or {}
    mode = opts.get("mode") or "commit"
    path = "/".join(x for x in (S.gh_root, rel) if x)
    target = S.gh_branch
    if mode == "pr":
        target = pr_branch(rel)
        if not gh_ref_sha(target):
            base = gh_ref_sha(S.gh_branch)
            if not base:
                raise HttpError(404, f"GitHub branch '{S.gh_branch}' not found")
            upstream("POST", f"{gh_base()}/git/refs", gh_headers(), {"ref": f"refs/heads/{target}", "sha": base})
    current = gh_file_sha(path, target)
    check_conflict(mode, opts, current)
    markdown = unrewrite_assets(markdown)
    markdown, assets = externalize_assets(markdown, rel) if S.assets else (markdown, [])
    for a in assets:
        apath = "/".join(x for x in (S.gh_root, a["rel"]) if x)
        cur = gh_file_sha(apath, target)
        if cur != git_blob_sha(a["data"]):
            gh_put(apath, a["data"], f"Journal asset {a['name']}", target, cur)
    data = markdown.encode()
    unchanged = current == git_blob_sha(data)
    url, sha = "", current
    if not unchanged:
        j = gh_put(path, data, message, target, current)
        url, sha = (j.get("commit") or {}).get("html_url", ""), (j.get("content") or {}).get("sha", "")
    res = {"provider": "GitHub", "path": path, "branch": target, "url": url, "sha": sha,
           "assets": len(assets), "unchanged": unchanged, "mode": mode}
    if mode == "pr":
        res["pr"] = gh_open_pr(target, opts.get("title") or message, pr_body(opts))
    return res


def gh_delete(rel: str, message: str, opts: dict | None = None) -> dict:
    """Delete a journal file (and nothing else). In PR mode the deletion goes on a branch with a pull request."""
    opts = opts or {}
    mode = opts.get("mode") or "commit"
    path = "/".join(x for x in (S.gh_root, rel) if x)
    target = S.gh_branch
    if mode == "pr":
        target = pr_branch(rel)
        if not gh_ref_sha(target):
            base = gh_ref_sha(S.gh_branch)
            if not base:
                raise HttpError(404, f"GitHub branch '{S.gh_branch}' not found")
            upstream("POST", f"{gh_base()}/git/refs", gh_headers(), {"ref": f"refs/heads/{target}", "sha": base})
    current = gh_file_sha(path, target)
    if not current:
        return {"provider": "GitHub", "path": path, "deleted": False, "missing": True, "mode": mode}
    upstream("DELETE", f"{gh_base()}/contents/{qpath(path)}", gh_headers(),
             {"message": message, "sha": current, "branch": target})
    res = {"provider": "GitHub", "path": path, "deleted": True, "branch": target, "mode": mode}
    if mode == "pr":
        res["pr"] = gh_open_pr(target, message, "Removes a journal entry.")
    return res


def gh_list() -> list:
    ref = upstream("GET", f"{gh_base()}/git/ref/heads/{qpath(S.gh_branch)}", gh_headers())
    tree_sha = (ref.get("object") or {}).get("sha")
    tree = upstream("GET", f"{gh_base()}/git/trees/{tree_sha}?recursive=1", gh_headers())
    prefix = S.gh_root + "/" if S.gh_root else ""
    return [{"name": t["path"].rsplit("/", 1)[-1], "path": t["path"], "sha": t.get("sha", "")}
            for t in tree.get("tree", [])
            if t.get("type") == "blob" and t["path"].startswith(prefix)
            and t["path"].lower().endswith(".md") and DATED.search(t["path"])]


def gh_content(path: str) -> str:
    path = under_root(path, S.gh_root)
    j = upstream("GET", f"{gh_base()}/contents/{qpath(path)}?ref={q(S.gh_branch)}", gh_headers())
    return base64.b64decode(j.get("content") or "").decode("utf-8", "replace")


# --------------------------------------------------------------------------- Azure DevOps

def ado_headers() -> dict:
    tok = base64.b64encode(f":{S.ado_pat}".encode()).decode()
    return {"Authorization": f"Basic {tok}"}


def ado_repo_base() -> str:
    return f"{S.ado_api}/{q(S.ado_org)}/{q(S.ado_project)}/_apis/git/repositories/{q(S.ado_repo)}"


def ado_ref(branch: str):
    refs = upstream("GET", f"{ado_repo_base()}/refs?filter=heads/{q(branch)}&api-version=7.1", ado_headers())
    return next((r.get("objectId") for r in refs.get("value", []) if r.get("name") == f"refs/heads/{branch}"), None)


def ado_item_id(path: str, branch: str):
    """Git object id of a file on a branch, or None if it doesn't exist."""
    try:
        j = upstream("GET", f"{ado_repo_base()}/items?path={q(path)}&versionDescriptor.version={q(branch)}"
                            f"&versionDescriptor.versionType=branch&$format=json&api-version=7.1", ado_headers())
    except HttpError as e:
        if e.status == 404:
            return None
        raise
    return j.get("objectId") or "exists"


def ado_web_repo() -> str:
    return f"{S.ado_web}/{q(S.ado_org)}/{q(S.ado_project)}/_git/{q(S.ado_repo)}"


def ado_open_pr(branch: str, title: str, desc: str) -> dict:
    base = ado_repo_base()
    try:
        j = upstream("POST", f"{base}/pullrequests?api-version=7.1", ado_headers(),
                     {"sourceRefName": f"refs/heads/{branch}", "targetRefName": f"refs/heads/{S.ado_branch}",
                      "title": title[:400], "description": desc[:4000]})
        n = j.get("pullRequestId")
        return {"number": n, "url": f"{ado_web_repo()}/pullrequest/{n}", "existing": False}
    except HttpError as e:
        if e.status != 409:
            raise
        lst = upstream("GET", f"{base}/pullrequests?searchCriteria.sourceRefName={q('refs/heads/' + branch)}"
                              f"&searchCriteria.status=active&api-version=7.1", ado_headers()).get("value", [])
        if lst:
            n = lst[0].get("pullRequestId")
            return {"number": n, "url": f"{ado_web_repo()}/pullrequest/{n}", "existing": True}
        raise


def ado_push(rel: str, markdown: str, message: str, opts: dict | None = None) -> dict:
    opts = opts or {}
    mode = opts.get("mode") or "commit"
    path = "/" + "/".join(x for x in (S.ado_root, rel) if x)
    base_head = ado_ref(S.ado_branch)
    if not base_head:
        raise HttpError(404, f"Azure DevOps branch '{S.ado_branch}' not found")
    branch, old, parents, check_branch = S.ado_branch, base_head, None, S.ado_branch
    if mode == "pr":
        branch = pr_branch(rel)
        head = ado_ref(branch)
        if head:
            old, check_branch = head, branch
        else:  # new branch, created by this push on top of the base branch
            old, parents = "0" * 40, [base_head]
    current = ado_item_id(path, check_branch)
    check_conflict(mode, opts, current)
    markdown = unrewrite_assets(markdown)
    markdown, assets = externalize_assets(markdown, rel) if S.assets else (markdown, [])
    changes = []
    for a in assets:
        apath = "/" + "/".join(x for x in (S.ado_root, a["rel"]) if x)
        if ado_item_id(apath, check_branch) == git_blob_sha(a["data"]):
            continue
        changes.append({"changeType": "edit" if ado_item_id(apath, check_branch) else "add", "item": {"path": apath},
                        "newContent": {"content": base64.b64encode(a["data"]).decode(), "contentType": "base64encoded"}})
    unchanged = current == git_blob_sha(markdown.encode())
    if not unchanged:
        changes.append({"changeType": "edit" if current else "add", "item": {"path": path},
                        "newContent": {"content": markdown, "contentType": "rawtext"}})
    if changes:
        commit = {"comment": message, "changes": changes}
        if parents:
            commit["parents"] = parents
        upstream("POST", f"{ado_repo_base()}/pushes?api-version=7.1", ado_headers(),
                 {"refUpdates": [{"name": f"refs/heads/{branch}", "oldObjectId": old}], "commits": [commit]})
    sha = ado_item_id(path, branch) if changes else current
    res = {"provider": "Azure DevOps", "path": path, "branch": branch, "url": f"{ado_web_repo()}?path={q(path)}&version=GB{q(branch)}",
           "sha": sha if sha != "exists" else "", "assets": len(assets), "unchanged": not changes, "mode": mode}
    if mode == "pr":
        res["pr"] = ado_open_pr(branch, opts.get("title") or message, pr_body(opts))
    return res


def ado_delete(rel: str, message: str, opts: dict | None = None) -> dict:
    opts = opts or {}
    mode = opts.get("mode") or "commit"
    path = "/" + "/".join(x for x in (S.ado_root, rel) if x)
    base_head = ado_ref(S.ado_branch)
    if not base_head:
        raise HttpError(404, f"Azure DevOps branch '{S.ado_branch}' not found")
    branch, old, parents, check_branch = S.ado_branch, base_head, None, S.ado_branch
    if mode == "pr":
        branch = pr_branch(rel)
        head = ado_ref(branch)
        if head:
            old, check_branch = head, branch
        else:
            old, parents = "0" * 40, [base_head]
    if not ado_item_id(path, check_branch):
        return {"provider": "Azure DevOps", "path": path, "deleted": False, "missing": True, "mode": mode}
    commit = {"comment": message, "changes": [{"changeType": "delete", "item": {"path": path}}]}
    if parents:
        commit["parents"] = parents
    upstream("POST", f"{ado_repo_base()}/pushes?api-version=7.1", ado_headers(),
             {"refUpdates": [{"name": f"refs/heads/{branch}", "oldObjectId": old}], "commits": [commit]})
    res = {"provider": "Azure DevOps", "path": path, "deleted": True, "branch": branch, "mode": mode}
    if mode == "pr":
        res["pr"] = ado_open_pr(branch, message, "Removes a journal entry.")
    return res


def ado_list() -> list:
    scope = "/" + S.ado_root if S.ado_root else "/"
    try:
        j = upstream("GET", f"{ado_repo_base()}/items?scopePath={q(scope)}&recursionLevel=Full"
                            f"&versionDescriptor.version={q(S.ado_branch)}&versionDescriptor.versionType=branch"
                            f"&api-version=7.1", ado_headers())
    except HttpError as e:
        if e.status == 404:
            return []
        raise
    return [{"name": it["path"].rsplit("/", 1)[-1], "path": it["path"], "objectId": it.get("objectId", "")}
            for it in j.get("value", [])
            if not it.get("isFolder") and it.get("path", "").lower().endswith(".md") and DATED.search(it["path"])]


def ado_content(path: str) -> str:
    rel = under_root(path, S.ado_root)
    data = upstream("GET", f"{ado_repo_base()}/items?path={q('/' + rel)}&versionDescriptor.version={q(S.ado_branch)}"
                           f"&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1",
                    {**ado_headers(), "Accept": "text/plain"}, raw=True)
    return data.decode("utf-8", "replace")


# --------------------------------------------------------------------------- repository extras

def gh_asset(path: str) -> bytes:
    rel = asset_rel(path, S.gh_root)
    return upstream("GET", f"{gh_base()}/contents/{qpath(rel)}?ref={q(S.gh_branch)}",
                    {**gh_headers(), "Accept": "application/vnd.github.raw"}, raw=True)


def ado_asset(path: str) -> bytes:
    rel = asset_rel(path.lstrip("/"), S.ado_root)
    return upstream("GET", f"{ado_repo_base()}/items?path={q('/' + rel)}&versionDescriptor.version={q(S.ado_branch)}"
                           f"&versionDescriptor.versionType=branch&$format=octetStream&api-version=7.1",
                    {**ado_headers(), "Accept": "application/octet-stream"}, raw=True)


def repo_test(provider: str) -> dict:
    if provider == "github":
        j = upstream("GET", gh_base(), gh_headers())
        perms = j.get("permissions") or {}
        return {"provider": "GitHub", "name": j.get("full_name"), "private": j.get("private"),
                "defaultBranch": j.get("default_branch"), "branch": S.gh_branch,
                "branchExists": gh_ref_sha(S.gh_branch) is not None, "canPush": bool(perms.get("push", True)),
                "root": S.gh_root, "url": j.get("html_url", "")}
    j = upstream("GET", f"{ado_repo_base()}?api-version=7.1", ado_headers())
    return {"provider": "Azure DevOps", "name": j.get("name"), "project": (j.get("project") or {}).get("name"),
            "defaultBranch": (j.get("defaultBranch") or "").replace("refs/heads/", ""), "branch": S.ado_branch,
            "branchExists": ado_ref(S.ado_branch) is not None, "root": S.ado_root, "url": ado_web_repo()}


# --------------------------------------------------------------------------- GitHub Issues (work-item contract)
# The app's work-items drawer speaks Azure Boards field names. GitHub issues are translated into the same
# shape so one drawer serves both: System.Title, System.State, System.WorkItemType (from a type label),
# System.Tags (other labels), Microsoft.VSTS.Common.Priority (a P1-P4 label), System.IterationPath (milestone),
# and an "Acceptance criteria" section kept inside the issue body.

PRIO_LABEL = re.compile(r"^(?:priority[:/ -]*)?p([0-4])$", re.I)
AC_HEAD = re.compile(r"(?im)^#{2,3}\s*acceptance criteria\s*$")
GH_STATES = ["Open", "Closed", "Not planned"]


def gh_type_label(t: str) -> str:
    return {"feature": "enhancement"}.get(t.lower(), t.lower())


def gh_issue_type(labels: list) -> str:
    low = {l.lower() for l in labels}
    return next((t for t in S.gh_issue_types if gh_type_label(t) in low), "Issue")


def split_ac(body: str):
    body = body or ""
    m = AC_HEAD.search(body)
    if not m:
        return body.strip(), ""
    rest = body[m.end():]
    n = re.search(r"(?m)^#{1,3}\s+\S", rest)
    ac = rest[:n.start()] if n else rest
    main = body[:m.start()] + (rest[n.start():] if n else "")
    return main.strip(), ac.strip()


def join_ac(main: str, ac: str) -> str:
    main, ac = (main or "").strip(), (ac or "").strip()
    return main + ("\n\n## Acceptance criteria\n\n" + ac if ac else "")


def html_to_md(s: str) -> str:
    """Small, safe conversion for text the drawer sends as HTML (lists, breaks, paragraphs)."""
    s = str(s or "")
    if "<" not in s:
        return s
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)<li[^>]*>\s*", "- ", s)
    s = re.sub(r"(?i)</(li|p|div|h\d)>", "\n", s)
    s = re.sub(r"(?i)<(strong|b)>(.*?)</\1>", r"**\2**", s)
    s = re.sub(r"(?i)<(em|i)>(.*?)</\1>", r"*\2*", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html_unescape(s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def gh_markdown(md: str) -> str:
    if not (md or "").strip():
        return ""
    return upstream("POST", f"{S.gh_api}/markdown", gh_headers(),
                    {"text": md, "mode": "gfm", "context": f"{S.gh_owner}/{S.gh_repo}"}, raw=True).decode("utf-8", "replace")


def gh_issue_norm(i: dict, detail: bool = False) -> dict:
    labels = [l.get("name") if isinstance(l, dict) else str(l) for l in i.get("labels") or []]
    prio = next((int(m.group(1)) for m in (PRIO_LABEL.match(l) for l in labels) if m), None)
    wtype = gh_issue_type(labels)
    tags = [l for l in labels if not PRIO_LABEL.match(l) and l.lower() != gh_type_label(wtype)]
    closed = i.get("state") == "closed"
    reason = i.get("state_reason") or ""
    state = ("Not planned" if reason == "not_planned" else "Closed") if closed else "Open"
    assignees = i.get("assignees") or ([i["assignee"]] if i.get("assignee") else [])
    f = {"System.Title": i.get("title", ""), "System.State": state,
         "System.Reason": {"completed": "Completed", "not_planned": "Not planned", "reopened": "Reopened"}.get(reason, ""),
         "System.WorkItemType": wtype, "System.Tags": "; ".join(tags),
         "System.AssignedTo": {"displayName": assignees[0]["login"], "uniqueName": assignees[0]["login"]} if assignees else "",
         "System.CreatedDate": i.get("created_at"), "System.ChangedDate": i.get("updated_at"),
         "System.CreatedBy": {"displayName": (i.get("user") or {}).get("login", "")},
         "System.IterationPath": (i.get("milestone") or {}).get("title", "")}
    if prio:
        f["Microsoft.VSTS.Common.Priority"] = prio
    if detail:
        main, ac = split_ac(i.get("body") or "")
        f["System.Description"] = gh_markdown(main)
        if ac:
            f["Microsoft.VSTS.Common.AcceptanceCriteria"] = gh_markdown(ac)
    return {"id": i.get("number"), "provider": "github", "url": i.get("html_url", ""), "nodeId": i.get("node_id", ""),
            "fields": f}


def gh_issue_get(n: int) -> dict:
    return upstream("GET", f"{gh_base()}/issues/{n}", gh_headers())


def gh_issue_payload(fields: dict, current: dict | None = None, wtype: str | None = None) -> dict:
    cur_labels = [l.get("name") if isinstance(l, dict) else str(l) for l in (current or {}).get("labels") or []]
    out = {}
    if "System.Title" in fields:
        out["title"] = str(fields["System.Title"])[:256]
    if "System.State" in fields:
        st = str(fields["System.State"]).strip().lower()
        if st in ("open", "active", "new", "reopened"):
            out["state"] = "open"
        elif st in ("not planned", "removed", "won't fix"):
            out["state"], out["state_reason"] = "closed", "not_planned"
        elif st in ("closed", "done", "resolved", "completed"):
            out["state"], out["state_reason"] = "closed", "completed"
        else:
            raise HttpError(400, "GitHub issues can be Open, Closed or Not planned")
    if "System.AssignedTo" in fields:
        a = fields["System.AssignedTo"]
        a = a.get("uniqueName") or a.get("displayName") if isinstance(a, dict) else str(a or "")
        a = a.strip().lstrip("@")
        out["assignees"] = [] if not a or a.lower() == "unassigned" else [a]
    labels = None
    if wtype is not None or "System.Tags" in fields or "Microsoft.VSTS.Common.Priority" in fields:
        cur_type = gh_issue_type(cur_labels)
        keep_type = gh_type_label(wtype) if wtype and wtype != "Issue" else (gh_type_label(cur_type) if cur_type != "Issue" else None)
        cur_prio = [l for l in cur_labels if PRIO_LABEL.match(l)]
        others = [l for l in cur_labels if not PRIO_LABEL.match(l) and (keep_type is None or l.lower() != keep_type)
                  and l.lower() != gh_type_label(cur_type)]
        if "System.Tags" in fields:
            others = [t.strip() for t in re.split(r"[;,]", str(fields["System.Tags"] or "")) if t.strip()]
        if "Microsoft.VSTS.Common.Priority" in fields:
            pv = str(fields["Microsoft.VSTS.Common.Priority"] or "").strip()
            cur_prio = [f"P{int(pv)}"] if pv.isdigit() and 0 <= int(pv) <= 4 else []
        labels = ([keep_type] if keep_type else []) + cur_prio + others
        out["labels"] = list(dict.fromkeys(l[:50] for l in labels))
    if "System.Description" in fields or "Microsoft.VSTS.Common.AcceptanceCriteria" in fields:
        main, ac = split_ac((current or {}).get("body") or "")
        if "System.Description" in fields:
            main = html_to_md(fields["System.Description"])
        if "Microsoft.VSTS.Common.AcceptanceCriteria" in fields:
            ac = html_to_md(fields["Microsoft.VSTS.Common.AcceptanceCriteria"])
        out["body"] = join_ac(main, ac)[:65000]
    return out


def gh_issue_query(body: dict) -> dict:
    parts = [f"repo:{S.gh_owner}/{S.gh_repo}", "is:issue"]
    states = [str(x).lower() for x in body.get("states") or []]
    if states == ["open"]:
        parts.append("is:open")
    elif states == ["closed"]:
        parts += ["is:closed", 'reason:completed']
    elif states == ["not planned"]:
        parts += ["is:closed", 'reason:"not planned"']
    for t in (body.get("types") or [])[:1]:
        if t and t != "Issue":
            parts.append(f'label:"{gh_type_label(str(t)).replace(chr(34), "")}"')
    if body.get("assignedToMe"):
        parts.append("assignee:@me")
    if body.get("search"):
        parts.append(re.sub(r'[^\w\s.-]', " ", str(body["search"]))[:120] + " in:title")
    j = upstream("GET", f"{S.gh_api}/search/issues?q={q(' '.join(parts))}&sort=updated&order=desc&per_page=50", gh_headers())
    items = [gh_issue_norm(i) for i in j.get("items", []) if "pull_request" not in i]
    return {"value": items, "count": len(items)}


# --------------------------------------------------------------------------- GitHub Projects (v2)

_project_cache = {"t": 0.0, "v": None}

PROJECT_Q = """query($login:String!,$number:Int!,$field:String!){
  user(login:$login){ projectV2(number:$number){ ...P } }
  organization(login:$login){ projectV2(number:$number){ ...P } }
}
fragment P on ProjectV2 { id title url number
  field(name:$field){ ... on ProjectV2SingleSelectField { id options { id name } } }
  items(first:100){ nodes { id
    fieldValueByName(name:$field){ ... on ProjectV2ItemFieldSingleSelectValue { name optionId } }
    content { __typename
      ... on Issue { number title state url repository { nameWithOwner } }
      ... on PullRequest { number title state url repository { nameWithOwner } }
      ... on DraftIssue { title } } } } }"""


def gh_graphql(query: str, variables: dict) -> dict:
    j = upstream("POST", S.gh_graphql, {"Authorization": f"Bearer {S.gh_projects_token}"},
                 {"query": query, "variables": variables})
    if j.get("errors") and not any((j.get("data") or {}).values()):
        msg = "; ".join(e.get("message", "") for e in j["errors"])[:300]
        raise HttpError(502, redact("GitHub Projects: " + msg))
    return j.get("data") or {}


def gh_project(force: bool = False) -> dict:
    if not force and _project_cache["v"] and time.time() - _project_cache["t"] < 20:
        return _project_cache["v"]
    d = gh_graphql(PROJECT_Q, {"login": S.gh_project_owner, "number": S.gh_project_number, "field": S.gh_project_field})
    p = ((d.get("user") or {}).get("projectV2")) or ((d.get("organization") or {}).get("projectV2"))
    if not p:
        raise HttpError(404, f"GitHub project #{S.gh_project_number} was not found for '{S.gh_project_owner}', or the token can't read it")
    field = p.get("field") or {}
    items = []
    for n in (p.get("items") or {}).get("nodes") or []:
        c = n.get("content") or {}
        fv = n.get("fieldValueByName") or {}
        items.append({"itemId": n.get("id"), "kind": {"Issue": "issue", "PullRequest": "pull", "DraftIssue": "draft"}.get(c.get("__typename"), "item"),
                      "number": c.get("number"), "title": c.get("title", ""), "state": (c.get("state") or "").lower(),
                      "url": c.get("url", ""), "repo": (c.get("repository") or {}).get("nameWithOwner", ""),
                      "status": fv.get("name") or ""})
    v = {"id": p["id"], "title": p.get("title"), "url": p.get("url"), "number": p.get("number"),
         "fieldId": field.get("id"), "statusField": S.gh_project_field,
         "statuses": [o.get("name") for o in field.get("options") or []],
         "_options": {o.get("name"): o.get("id") for o in field.get("options") or []}, "items": items}
    _project_cache.update(t=time.time(), v=v)
    return v


def gh_project_public(p: dict) -> dict:
    return {k: v for k, v in p.items() if not k.startswith("_") and k != "fieldId"}


def gh_project_set(body: dict) -> dict:
    p = gh_project()
    item_id = body.get("itemId")
    if not item_id:
        n = wit_id(body.get("issue"))
        node = gh_issue_get(n).get("node_id")
        d = gh_graphql("mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}",
                       {"p": p["id"], "c": node})
        item_id = (((d.get("addProjectV2ItemById") or {}).get("item")) or {}).get("id")
    status = body.get("status")
    if status:
        opt = p["_options"].get(status)
        if not opt or not p.get("fieldId"):
            raise HttpError(400, f"'{status}' is not an option of the project's {S.gh_project_field} field")
        gh_graphql("mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,"
                   "fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}",
                   {"p": p["id"], "i": item_id, "f": p["fieldId"], "o": opt})
    _project_cache["v"] = None
    return {"itemId": item_id, "status": status or ""}


# --------------------------------------------------------------------------- pipeline runs

GH_RESULT = {"success": "success", "failure": "failure", "cancelled": "cancelled", "skipped": "skipped",
             "timed_out": "failure", "action_required": "waiting", "neutral": "success", "startup_failure": "failure"}
ADO_RESULT = {"succeeded": "success", "failed": "failure", "canceled": "cancelled", "partiallySucceeded": "partial"}
ADO_STATUS = {"notStarted": "queued", "inProgress": "in_progress", "completed": "completed", "cancelling": "in_progress",
              "postponed": "queued"}


def runs_list(provider: str) -> dict:
    if provider == "github":
        j = upstream("GET", f"{gh_base()}/actions/runs?per_page=20", gh_headers())
        runs = [{"id": r.get("id"), "name": r.get("name") or "", "title": r.get("display_title") or "",
                 "status": r.get("status"), "result": GH_RESULT.get(r.get("conclusion") or "", r.get("conclusion") or ""),
                 "branch": r.get("head_branch") or "", "event": r.get("event") or "", "commit": (r.get("head_sha") or "")[:7],
                 "started": r.get("run_started_at") or r.get("created_at"), "updated": r.get("updated_at"),
                 "url": r.get("html_url", ""), "actor": (r.get("actor") or {}).get("login", ""), "attempt": r.get("run_attempt", 1)}
                for r in j.get("workflow_runs", [])]
        return {"provider": "GitHub Actions", "value": runs, "url": f"https://github.com/{S.gh_owner}/{S.gh_repo}/actions"}
    j = upstream("GET", f"{S.ado_api}/{q(S.ado_org)}/{q(S.ado_project)}/_apis/build/builds?$top=20&queryOrder=queueTimeDescending&api-version=7.1",
                 ado_headers())
    runs = [{"id": b.get("id"), "name": (b.get("definition") or {}).get("name", ""), "title": b.get("buildNumber", ""),
             "status": ADO_STATUS.get(b.get("status"), b.get("status")), "result": ADO_RESULT.get(b.get("result") or "", b.get("result") or ""),
             "branch": (b.get("sourceBranch") or "").replace("refs/heads/", ""), "event": b.get("reason", ""),
             "commit": (b.get("sourceVersion") or "")[:7], "started": b.get("startTime") or b.get("queueTime"),
             "updated": b.get("finishTime"), "url": ((b.get("_links") or {}).get("web") or {}).get("href", ""),
             "actor": (b.get("requestedFor") or {}).get("displayName", ""), "definitionId": (b.get("definition") or {}).get("id")}
            for b in j.get("value", [])]
    return {"provider": "Azure Pipelines", "value": runs, "url": f"{S.ado_web}/{q(S.ado_org)}/{q(S.ado_project)}/_build"}


def runs_rerun(provider: str, body: dict) -> dict:
    rid = wit_id(body.get("id"))
    if provider == "github":
        failed = str(body.get("result") or "") in ("failure", "cancelled")
        upstream("POST", f"{gh_base()}/actions/runs/{rid}/{'rerun-failed-jobs' if failed else 'rerun'}", gh_headers(), {})
        return {"ok": True, "id": rid, "mode": "failed jobs" if failed else "all jobs"}
    b = upstream("GET", f"{S.ado_api}/{q(S.ado_org)}/{q(S.ado_project)}/_apis/build/builds/{rid}?api-version=7.1", ado_headers())
    nb = upstream("POST", f"{S.ado_api}/{q(S.ado_org)}/{q(S.ado_project)}/_apis/build/builds?api-version=7.1", ado_headers(),
                  {"definition": {"id": (b.get("definition") or {}).get("id")}, "sourceBranch": b.get("sourceBranch")})
    return {"ok": True, "id": nb.get("id"), "mode": "queued a new run"}


# --------------------------------------------------------------------------- Azure Boards

PROJECT_RE = re.compile(r"^[^/\\?#%*:|\"<>]{1,64}$")
FIELD_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.]{1,127}$")
LIST_FIELDS = ["System.Id", "System.Title", "System.State", "System.WorkItemType", "System.AssignedTo",
               "System.ChangedDate", "System.Tags", "Microsoft.VSTS.Common.Priority", "System.AreaPath",
               "System.IterationPath"]
CLOSED = ("Closed", "Done", "Removed", "Completed", "Cut")


def wit_project(qs: dict, body: dict | None = None) -> str:
    p = ((body or {}).get("project") or (qs.get("project") or [""])[0] or "").strip()
    if not p or not S.wit_multi_project:
        return S.ado_project
    if not PROJECT_RE.match(p):
        raise HttpError(400, "Invalid project name")
    if S.wit_projects and p not in S.wit_projects and p != S.ado_project:
        raise HttpError(403, "Project is not in DAILY_ADO_WIT_PROJECTS")
    return p


def wit_base(project: str) -> str:
    return f"{S.ado_api}/{q(S.ado_org)}/{q(project)}/_apis/wit"


def wit_id(v) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise HttpError(400, "Invalid work item id") from None
    if n <= 0:
        raise HttpError(400, "Invalid work item id")
    return n


def wit_patch(fields: dict) -> list:
    if not isinstance(fields, dict) or not fields:
        raise HttpError(400, "fields is required")
    ops = []
    for k, v in fields.items():
        if not FIELD_RE.match(str(k)):
            raise HttpError(400, f"Invalid field name: {k}")
        ops.append({"op": "add", "path": f"/fields/{k}", "value": v})
    return ops


def wiql_escape(s: str) -> str:
    return str(s).replace("'", "''")


def wit_query(body: dict, project: str) -> dict:
    wiql = (body.get("wiql") or "").strip()
    if wiql:
        if not wiql.upper().startswith("SELECT") or ";" in wiql:
            raise HttpError(400, "Only a single SELECT query is allowed")
    else:
        where = ["[System.TeamProject] = @project"]
        states = [s for s in (body.get("states") or []) if isinstance(s, str)]
        if states:
            where.append("[System.State] IN (" + ",".join(f"'{wiql_escape(s)}'" for s in states) + ")")
        else:
            where.append("[System.State] NOT IN (" + ",".join(f"'{s}'" for s in CLOSED) + ")")
        types = [t for t in (body.get("types") or []) if isinstance(t, str)]
        if types:
            where.append("[System.WorkItemType] IN (" + ",".join(f"'{wiql_escape(t)}'" for t in types) + ")")
        if body.get("assignedToMe"):
            where.append("[System.AssignedTo] = @Me")
        if body.get("search"):
            where.append(f"[System.Title] CONTAINS '{wiql_escape(body['search'])[:200]}'")
        wiql = "SELECT [System.Id] FROM WorkItems WHERE " + " AND ".join(where) + " ORDER BY [System.ChangedDate] DESC"
    res = upstream("POST", f"{wit_base(project)}/wiql?$top=200&api-version=7.1", ado_headers(), {"query": wiql})
    ids = [w["id"] for w in res.get("workItems", [])][:200]
    if not ids:
        return {"value": [], "count": 0}
    items = upstream("POST", f"{wit_base(project)}/workitemsbatch?api-version=7.1", ado_headers(),
                     {"ids": ids, "fields": LIST_FIELDS}).get("value", [])
    order = {i: n for n, i in enumerate(ids)}
    items.sort(key=lambda it: order.get(it.get("id"), 0))
    return {"value": items, "count": len(items)}


# --------------------------------------------------------------------------- AI proxy
#
# The page always speaks OpenAI Chat Completions to /v1/chat/completions. The relay
# translates to whatever the configured provider expects, adds credentials, adapts
# parameters that particular models reject, and streams the answer back.

ALLOWED_AI_KEYS = {"messages", "temperature", "max_tokens", "max_completion_tokens", "stream", "top_p",
                   "stop", "response_format", "presence_penalty", "frequency_penalty", "seed"}
REASONING_MODEL = re.compile(r"^(o\d|gpt-5|gpt-oss|deepseek-r1|qwq|.*-reasoner|.*-thinking)", re.I)
ANTHROPIC_VERSION = "2023-06-01"
_ENTRA = {"token": "", "exp": 0.0}
_ENTRA_LOCK = threading.Lock()


def ai_reasoning() -> bool:
    if S.ai_reasoning != "auto":
        return S.ai_reasoning == "on"
    return S.ai_kind != "anthropic" and bool(REASONING_MODEL.match(S.ai_model or ""))


def ai_endpoint() -> tuple[str, bool]:
    """(url, include_model_in_body) for the configured provider."""
    base = S.ai_base.rstrip("/")
    if S.ai_kind == "anthropic":
        if base.endswith("/messages"):
            return base, True
        if not re.search(r"/v1$", base):
            base += "/v1"
        return base + "/messages", True
    if S.ai_kind == "azure":
        if base.endswith("/chat/completions"):
            url, include = base, "/openai/deployments/" not in base
        elif "/openai/deployments/" in base:
            url, include = base + "/chat/completions", False
        elif re.search(r"/openai/v1$", base) or re.search(r"/models$", base):
            url, include = base + "/chat/completions", True
        elif S.ai_version:  # classic deployment route, versioned
            url, include = f"{base}/openai/deployments/{q(S.ai_model)}/chat/completions", False
        else:               # v1 API: no api-version, deployment name goes in "model"
            url, include = base + "/openai/v1/chat/completions", True
        if "/openai/v1/" not in url and "api-version=" not in url:
            ver = S.ai_version or ("2024-05-01-preview" if "/models/" in url else "2024-10-21")
            url += ("&" if "?" in url else "?") + "api-version=" + q(ver)
        return url, include
    if base.endswith("/chat/completions"):
        return base, True
    if urllib.parse.urlsplit(base).path in ("", "/"):
        base += "/v1"
    return base + "/chat/completions", True


def ai_models_url() -> str:
    base = S.ai_base.rstrip("/")
    if S.ai_kind == "anthropic":
        return (base if re.search(r"/v1$", base) else base + "/v1") + "/models"
    if S.ai_kind == "azure":
        root = re.sub(r"/openai(/.*)?$", "", base)
        return root + "/openai/v1/models"
    if urllib.parse.urlsplit(base).path in ("", "/"):
        base += "/v1"
    return re.sub(r"/chat/completions$", "", base) + "/models"


def entra_token() -> str:
    """Microsoft Entra ID token for Azure-hosted models: service principal from .env, else the Azure CLI."""
    with _ENTRA_LOCK:
        if _ENTRA["token"] and time.time() < _ENTRA["exp"] - 120:
            return _ENTRA["token"]
        scope = S.ai_entra_scope
        if S.ai_tenant and S.ai_client_id and S.ai_client_secret:
            form = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": S.ai_client_id,
                                           "client_secret": S.ai_client_secret, "scope": scope}).encode()
            req = urllib.request.Request(f"{S.ai_authority}/{q(S.ai_tenant)}/oauth2/v2.0/token",
                                         data=form, method="POST",
                                         headers={"Content-Type": "application/x-www-form-urlencoded"})
            try:
                with urllib.request.urlopen(req, timeout=S.timeout) as r:
                    j = json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as e:
                try:
                    msg = json.loads(e.read() or b"{}").get("error_description", "")
                except ValueError:
                    msg = ""
                raise HttpError(502, redact(f"Entra ID sign-in failed ({e.code}): {msg.splitlines()[0][:200] if msg else 'check tenant, client ID and secret'}")) from None
            except urllib.error.URLError as e:
                raise HttpError(502, f"Entra ID unreachable: {e.reason}") from None
            _ENTRA.update(token=j.get("access_token", ""), exp=time.time() + int(j.get("expires_in") or 3000))
        else:
            import shutil
            import subprocess
            az = shutil.which("az") or shutil.which("az.cmd")
            if not az:
                raise HttpError(502, "DAILY_AI_AUTH=entra needs the Azure CLI (az) signed in with `az login`, "
                                     "or DAILY_AI_TENANT_ID / DAILY_AI_CLIENT_ID / DAILY_AI_CLIENT_SECRET")
            resource = re.sub(r"/\.default$", "", scope)
            cmd = [az, "account", "get-access-token", "--resource", resource, "-o", "json"]
            if os.name == "nt" and az.lower().endswith((".cmd", ".bat")):
                cmd = ["cmd", "/c"] + cmd
            try:
                p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            except (OSError, subprocess.TimeoutExpired) as e:
                raise HttpError(502, f"Azure CLI failed: {e}") from None
            if p.returncode != 0:
                err = (p.stderr or "").strip().splitlines()
                hint = next((l for l in err if l.strip()), "run `az login`")
                raise HttpError(502, redact(f"Azure CLI could not get a token: {hint[:200]}"))
            j = json.loads(p.stdout or "{}")
            exp = j.get("expires_on")
            try:
                exp = float(exp) if exp else time.time() + 3000
            except (TypeError, ValueError):
                exp = time.time() + 3000
            _ENTRA.update(token=j.get("accessToken", ""), exp=exp)
        if not _ENTRA["token"]:
            raise HttpError(502, "Entra ID returned no access token")
        return _ENTRA["token"]


def ai_headers() -> dict:
    h = {"Content-Type": "application/json", "User-Agent": f"the-daily-relay/{VERSION}"}
    if S.ai_kind == "anthropic":
        h["anthropic-version"] = ANTHROPIC_VERSION
    if S.ai_auth == "entra":
        h["Authorization"] = "Bearer " + entra_token()
    elif S.ai_key:
        if S.ai_kind == "anthropic":
            h["x-api-key"] = S.ai_key
        elif S.ai_kind == "azure":
            h["api-key"] = S.ai_key
        else:
            h["Authorization"] = f"Bearer {S.ai_key}"
    return h


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p if isinstance(p, str) else str(p.get("text") or "") for p in content if isinstance(p, (str, dict)))
    return str(content or "")


def ai_prepare(data: dict) -> dict:
    """Shape an OpenAI-style request for the configured provider."""
    data = dict(data)
    for k in ("max_tokens", "max_completion_tokens"):
        if k in data:
            try:
                data[k] = max(1, min(int(data[k]), S.ai_max_tokens))
            except (TypeError, ValueError):
                data.pop(k)
    if S.ai_kind == "anthropic":
        system = "\n\n".join(_text_of(m.get("content")) for m in data["messages"] if m.get("role") == "system")
        msgs: list[dict] = []
        for m in data["messages"]:
            role = m.get("role")
            if role not in ("user", "assistant"):
                continue
            text = _text_of(m.get("content"))
            if msgs and msgs[-1]["role"] == role:
                msgs[-1]["content"] += "\n\n" + text
            else:
                msgs.append({"role": role, "content": text})
        if not msgs or msgs[0]["role"] != "user":
            msgs.insert(0, {"role": "user", "content": "(continue)"})
        out = {"model": S.ai_model, "messages": msgs,
               "max_tokens": data.get("max_tokens") or data.get("max_completion_tokens") or min(1024, S.ai_max_tokens)}
        if system:
            out["system"] = system
        if "temperature" in data:
            try:
                out["temperature"] = max(0.0, min(1.0, float(data["temperature"])))
            except (TypeError, ValueError):
                pass
        if data.get("stop"):
            out["stop_sequences"] = data["stop"] if isinstance(data["stop"], list) else [data["stop"]]
        if data.get("stream"):
            out["stream"] = True
        return out
    if ai_reasoning():
        n = data.pop("max_tokens", None) or data.get("max_completion_tokens") or S.ai_max_tokens
        data["max_completion_tokens"] = min(S.ai_max_tokens, max(int(n), S.ai_reasoning_floor))
        data.pop("temperature", None)
        data.pop("top_p", None)
        if S.ai_effort:
            data["reasoning_effort"] = S.ai_effort
    return data


def ai_adapt(data: dict, status: int, text: str, adapted: list) -> bool:
    """Adjust a rejected request (400) so it suits the model. Returns True if a retry makes sense."""
    if status != 400:
        return False
    low = text.lower()
    if "max_tokens" in low and "max_completion_tokens" in low:
        if "max_tokens" in data:
            data["max_completion_tokens"] = data.pop("max_tokens")
            adapted.append("used max_completion_tokens")
            return True
        if "max_completion_tokens" in data:
            data["max_tokens"] = data.pop("max_completion_tokens")
            adapted.append("used max_tokens")
            return True
    for p in ("temperature", "top_p", "reasoning_effort", "presence_penalty", "frequency_penalty", "seed", "response_format"):
        if p in low and p in data:
            data.pop(p)
            adapted.append(f"dropped {p}")
            return True
    m = re.search(r"unsupported parameter:?\s*['\"`]?([a-z_]+)", low)
    if m and m.group(1) in data:
        data.pop(m.group(1))
        adapted.append(f"dropped {m.group(1)}")
        return True
    return False


def ai_explain(status: int, msg: str) -> str:
    """A short, specific fix for common provider errors."""
    low = (msg or "").lower()
    az = S.ai_kind == "azure" or S.ai_azure_hosted
    if status in (401, 403) and ("key based authentication is disabled" in low or "disablelocalauth" in low):
        return "This resource has API keys turned off. Set DAILY_AI_AUTH=entra and sign in with `az login`."
    if status == 401:
        if S.ai_auth == "entra":
            return "The Entra ID token was rejected. Check that you signed in to the right tenant (`az login --tenant …`)."
        return ("The key was rejected. Copy Key 1 from the resource's Keys and Endpoint page (or the deployment's "
                "Details tab) into DAILY_AI_API_KEY." if az else "The API key was rejected. Check DAILY_AI_API_KEY.")
    if status == 403:
        if "public" in low or "firewall" in low or "virtual network" in low or "private" in low:
            return "The resource blocks this network. Allow your IP in Networking, or connect from the allowed network."
        if S.ai_auth == "entra":
            return "Your identity needs the 'Cognitive Services OpenAI User' or 'Foundry User' role on the resource."
        return "Access denied: the key or identity doesn't have access to this model."
    if status == 404:
        if az:
            return (f"No deployment named '{S.ai_model}'. DAILY_AI_MODEL must be the deployment name from "
                    "Foundry → Models + endpoints (it can differ from the model name), and the base URL should be "
                    "https://<resource>.openai.azure.com/openai/v1.")
        return f"Model '{S.ai_model}' or the endpoint path wasn't found. Check DAILY_AI_MODEL and DAILY_AI_BASE_URL."
    if status == 400 and "api version" in low:
        return "Use the v1 endpoint (…/openai/v1) and leave DAILY_AI_API_VERSION empty, or set a supported version."
    if status == 429:
        return "Rate limit or quota reached. Wait a moment, or raise the deployment's tokens-per-minute limit."
    if status >= 500:
        return "The provider had a temporary problem. Try again shortly."
    return ""


def ai_unreachable(reason) -> str:
    r = str(reason)
    low = r.lower()
    host = urllib.parse.urlsplit(S.ai_base).hostname or S.ai_base
    if "name or service not known" in low or "getaddrinfo" in low or "nodename nor servname" in low or "no address" in low:
        return f"Can't resolve {host}. Check the resource name in DAILY_AI_BASE_URL."
    if "refused" in low:
        return f"Nothing is listening at {host}. If this is Ollama or LM Studio, start it and enable its server."
    if "certificate" in low or "ssl" in low:
        return "TLS check failed. Behind a corporate proxy, point SSL_CERT_FILE at your organization's CA bundle."
    if "timed out" in low:
        return f"{host} didn't answer in time. Check your network or VPN."
    return f"Couldn't reach {host}: {r[:160]}"


def ai_to_openai(j: dict) -> dict:
    """Anthropic Messages response → Chat Completions shape."""
    text = "".join(b.get("text", "") for b in j.get("content") or [] if b.get("type") == "text")
    u = j.get("usage") or {}
    fin = {"end_turn": "stop", "max_tokens": "length", "stop_sequence": "stop"}.get(j.get("stop_reason"), "stop")
    return {"id": j.get("id", ""), "object": "chat.completion", "model": S.ai_model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": fin}],
            "usage": {"prompt_tokens": u.get("input_tokens", 0), "completion_tokens": u.get("output_tokens", 0),
                      "total_tokens": (u.get("input_tokens", 0) or 0) + (u.get("output_tokens", 0) or 0)}}


def ai_request(data: dict, adapted: list | None = None):
    """Send a prepared request, adapting and retrying as needed. Returns the open HTTP response."""
    adapted = adapted if adapted is not None else []
    url, include_model = ai_endpoint()
    body = ai_prepare(data)
    if include_model and S.ai_kind != "anthropic":
        body["model"] = S.ai_model  # the relay decides the model, not the browser
    retried_busy = False
    for _attempt in range(7):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=ai_headers(), method="POST")
        try:
            return urllib.request.urlopen(req, timeout=max(S.timeout, 120)), body
        except urllib.error.HTTPError as e:
            raw = e.read() or b""
            txt = raw.decode("utf-8", "replace")
            if ai_adapt(body, e.code, txt, adapted):
                continue
            if e.code in (429, 500, 502, 503, 504) and not retried_busy:
                retried_busy = True
                try:
                    wait = min(float(e.headers.get("Retry-After") or 2), 6)
                except (TypeError, ValueError):
                    wait = 2
                time.sleep(wait)
                continue
            if e.code == 401 and S.ai_auth == "entra" and _ENTRA["token"]:
                _ENTRA.update(token="", exp=0)
            try:
                jj = json.loads(raw)
                msg = (jj.get("error") or {}).get("message") if isinstance(jj.get("error"), dict) else jj.get("error")
                msg = msg or jj.get("message") or ""
            except ValueError:
                msg = txt.strip()[:200]
            fix = ai_explain(e.code, msg)
            raise HttpError(e.code if e.code < 500 else 502,
                            redact(f"AI provider {e.code}" + (f": {str(msg)[:300]}" if msg else "") + (f" — {fix}" if fix else ""))) from None
        except urllib.error.URLError as e:
            raise HttpError(502, redact("AI provider unreachable — " + ai_unreachable(e.reason))) from None
        except (TimeoutError, OSError) as e:
            raise HttpError(504, "AI provider timed out — " + ai_unreachable(e)) from None
    raise HttpError(502, "The AI provider kept rejecting the request: " + ", ".join(adapted))


def ai_complete(data: dict) -> tuple[dict, list]:
    """Non-streaming completion in Chat Completions shape. Retries once with more room when a
    reasoning model spends its whole budget thinking and returns no text."""
    adapted: list = []
    resp, body = ai_request(data, adapted)
    with resp:
        j = json.loads(resp.read() or b"{}")
    if S.ai_kind == "anthropic":
        return ai_to_openai(j), adapted
    ch = (j.get("choices") or [{}])[0]
    content = _text_of((ch.get("message") or {}).get("content"))
    if not content.strip() and ch.get("finish_reason") == "length":
        key = "max_completion_tokens" if "max_completion_tokens" in body else "max_tokens"
        cur = int(body.get(key) or 0)
        bigger = min(S.ai_max_tokens, max(cur * 4, S.ai_reasoning_floor, 1024))
        if bigger > cur:
            d2 = dict(data)
            d2.pop("max_tokens", None)
            d2["max_completion_tokens"] = bigger
            d2.pop("temperature", None)
            adapted.append(f"raised token budget to {bigger} (the model used it all for reasoning)")
            resp, _ = ai_request(d2, adapted)
            with resp:
                j = json.loads(resp.read() or b"{}")
    return j, adapted


def ai_public() -> dict:
    url = ""
    if S.ai_base:
        try:
            url = ai_endpoint()[0]
        except Exception:  # noqa: BLE001
            url = ""
    return {"configured": S.ai_enabled, "provider": S.ai_provider, "label": S.ai_label, "kind": S.ai_kind,
            "model": S.ai_model if S.ai_enabled else "", "auth": S.ai_auth,
            "host": urllib.parse.urlsplit(S.ai_base).hostname or "", "endpoint": re.sub(r"\?.*$", "", url),
            "reasoning": ai_reasoning() if S.ai_model else False, "maxTokens": S.ai_max_tokens,
            "missing": S.ai_missing}


def ai_doctor() -> dict:
    """Step-by-step connection check with a specific fix for whatever fails."""
    steps: list[dict] = []

    def step(label, ok, detail="", fix=""):
        steps.append({"label": label, "ok": ok, "detail": detail, "fix": fix})
        return ok

    pub = ai_public()
    cfg_ok = step("Configuration", not S.ai_missing,
                  f"{S.ai_label} · model {S.ai_model or '—'} · auth {S.ai_auth}",
                  ("Add to .env: " + ", ".join(S.ai_missing) + ", then restart the relay.") if S.ai_missing else "")
    if not cfg_ok:
        return {"ok": False, "steps": steps, "ai": pub}
    url = pub["endpoint"]
    host = urllib.parse.urlsplit(url).hostname or ""
    port = urllib.parse.urlsplit(url).port or (443 if url.startswith("https") else 80)
    import socket
    try:
        socket.getaddrinfo(host, port)
        with socket.create_connection((host, port), timeout=8):
            pass
        step("Network", True, f"{host}:{port} reachable")
    except OSError as e:
        step("Network", False, f"{host}:{port}", ai_unreachable(e))
        return {"ok": False, "steps": steps, "ai": pub}
    if S.ai_auth == "entra":
        try:
            entra_token()
            step("Credentials", True, "Entra ID token acquired" +
                 (" (service principal)" if S.ai_client_id else " (Azure CLI)"))
        except HttpError as e:
            step("Credentials", False, "Entra ID", e.message)
            return {"ok": False, "steps": steps, "ai": pub}
    else:
        step("Credentials", bool(S.ai_key) or not AI_NEEDS_KEY.get(S.ai_provider, False),
             "API key from .env" if S.ai_key else "no key (not required for this provider)")
    t0 = time.time()
    try:
        j, adapted = ai_complete({"messages": [{"role": "user", "content": "Reply with exactly one word: connected"}],
                                  "max_tokens": 16, "temperature": 0})
        ms = int((time.time() - t0) * 1000)
        reply = _text_of(((j.get("choices") or [{}])[0].get("message") or {}).get("content")).strip()
        step("Test request", bool(reply), f"{ms} ms · replied “{reply[:40]}”" if reply else "empty reply",
             "" if reply else "The model returned no text. Raise DAILY_AI_MAX_TOKENS or set DAILY_AI_REASONING=on.")
        if adapted:
            step("Adjustments", True, "; ".join(adapted),
                 "Handled automatically. To skip the extra round trip, set DAILY_AI_REASONING=on for reasoning models.")
        return {"ok": bool(reply), "steps": steps, "ai": pub, "latencyMs": ms, "reply": reply[:200],
                "usage": j.get("usage") or {}, "endpoint": url}
    except HttpError as e:
        step("Test request", False, url, e.message)
        return {"ok": False, "steps": steps, "ai": pub, "endpoint": url}


def ai_models() -> dict:
    url = ai_models_url()
    h = ai_headers()
    h.pop("Content-Type", None)
    try:
        j = upstream("GET", url, h)
    except HttpError as e:
        return {"models": [], "note": e.message, "current": S.ai_model}
    ids = sorted({str(m.get("id") or m.get("name") or "") for m in (j.get("data") or j.get("models") or []) if isinstance(m, dict)} - {""})
    note = ("These are models available to the resource. DAILY_AI_MODEL must be a deployment name, "
            "which you choose when you deploy a model in Foundry.") if S.ai_kind == "azure" else ""
    return {"models": ids[:300], "note": note, "current": S.ai_model}


# --------------------------------------------------------------------------- enterprise store

_ent_lock = threading.Lock()


def ent_file() -> Path:
    return S.data_dir / "enterprise-graph.json"


def ent_load() -> dict:
    try:
        return json.loads(ent_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"nodes": [], "edges": []}


def ent_ingest(body: dict) -> dict:
    nodes = [n for n in body.get("nodes", []) if isinstance(n, dict) and isinstance(n.get("id"), str)][:2000]
    edges = [e for e in body.get("edges", []) if isinstance(e, dict) and e.get("source") and e.get("target")][:5000]
    with _ent_lock:
        g = ent_load()
        by_id = {n["id"]: n for n in g["nodes"]}
        for n in nodes:
            by_id[n["id"]] = {**by_id.get(n["id"], {}), **n}
        seen = {(e["source"], e["target"], e.get("type")) for e in g["edges"]}
        for e in edges:
            k = (e["source"], e["target"], e.get("type"))
            if k not in seen:
                g["edges"].append(e)
                seen.add(k)
        g["nodes"] = list(by_id.values())[-20000:]
        g["edges"] = g["edges"][-50000:]
        S.data_dir.mkdir(parents=True, exist_ok=True)
        tmp = ent_file().with_suffix(".tmp")
        tmp.write_text(json.dumps(g), encoding="utf-8")
        tmp.replace(ent_file())
    return {"ok": True, "nodes": len(nodes), "edges": len(edges)}


# --------------------------------------------------------------------------- HTTP

CONNECT_SRC = ("'self' https://api.github.com https://dev.azure.com https://api.openai.com "
               "https://*.openai.azure.com https://*.services.ai.azure.com http://localhost:* http://127.0.0.1:*")
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob: https:; font-src 'self' data:; connect-src " + CONNECT_SRC + "; "
       "frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
       "form-action 'self'; frame-ancestors 'none'")
LOOPBACK_NAMES = {"localhost", "127.0.0.1", "[::1]", "::1"}


class Handler(BaseHTTPRequestHandler):
    server_version = "TheDailyRelay"
    sys_version = ""

    # ---- logging: method, path (no query string), status. Never headers or bodies.
    def log_message(self, fmt, *args):  # noqa: D401
        pass

    def log_request(self, code="-", size="-"):
        path = self.path.split("?", 1)[0]
        sys.stderr.write(f"{time.strftime('%H:%M:%S')} {self.command} {path} {code}\n")

    # ---- security gates
    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
        if name in LOOPBACK_NAMES or host in S.extra_hosts or name in S.extra_hosts:
            return True
        if S.host not in ("127.0.0.1", "localhost", "::1"):
            # Explicitly exposed: accept the bound address itself.
            return name == S.host.lower()
        return False

    def _self_origin(self) -> str:
        return f"http://{self.headers.get('Host', '')}".lower()

    def _origin_ok(self) -> bool:
        origin = (self.headers.get("Origin") or "").rstrip("/").lower()
        site = (self.headers.get("Sec-Fetch-Site") or "").lower()
        if origin:
            return origin == self._self_origin() or origin in {o.lower() for o in S.allowed_origins}
        # No Origin header: non-browser client (curl, scripts) or same-origin navigation.
        return site in ("", "same-origin", "none")

    def _key_ok(self) -> bool:
        if not S.client_key:
            return True
        supplied = self.headers.get("X-Daily-Client-Key") or ""
        return hmac.compare_digest(supplied.encode(), S.client_key.encode())

    # ---- responses
    def _common_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if origin and origin.lower() in {o.lower() for o in S.allowed_origins}:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def send_json(self, status: int, obj) -> None:
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._common_headers()
        self.end_headers()
        self.wfile.write(data)

    def send_text(self, status: int, text: str, ctype="text/markdown; charset=utf-8") -> None:
        data = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self._common_headers()
        self.end_headers()
        self.wfile.write(data)

    def fail(self, status: int, message: str) -> None:
        self.send_json(status, {"error": {"message": message}})

    def read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > S.max_body:
            raise HttpError(413, "Request body too large")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            j = json.loads(raw or b"{}")
        except ValueError:
            raise HttpError(400, "Body must be JSON") from None
        if not isinstance(j, dict):
            raise HttpError(400, "Body must be a JSON object")
        return j

    # ---- verbs
    def do_OPTIONS(self):
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if not self._host_ok() or origin.lower() not in {o.lower() for o in S.allowed_origins}:
            return self.fail(403, "Origin not allowed")
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Daily-Client-Key, api-key, Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_HEAD(self):
        self._dispatch("GET")

    def _dispatch(self, method: str):
        try:
            if not self._host_ok():
                return self.fail(421, "Unrecognized Host header")
            url = urllib.parse.urlsplit(self.path)
            path, qs = url.path, urllib.parse.parse_qs(url.query)
            is_api = path.startswith("/api/") or path.startswith("/v1/")
            if is_api:
                if not self._origin_ok():
                    return self.fail(403, "Cross-site request blocked")
                asset = path == "/api/repositories/asset" and method == "GET"
                if not asset and not self._key_ok():
                    return self.fail(401, "Missing or invalid X-Daily-Client-Key")
                return self._api(method, path, qs)
            if path == "/healthz":
                return self.send_json(200, {"status": "ok", "provider": "relay", "version": VERSION,
                                            "github": S.gh_enabled, "ado": S.ado_enabled,
                                            "workItems": S.wit_enabled, "ai": S.ai_enabled})
            if method != "GET":
                return self.fail(405, "Method not allowed")
            return self._static(path)
        except HttpError as e:
            self.fail(e.status, e.message)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(redact(f"Unhandled error: {type(e).__name__}: {e}\n"))
            try:
                self.fail(500, "Relay error")
            except Exception:  # noqa: BLE001
                pass

    # ---- static
    def _static(self, path: str):
        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        target = (S.static_dir / rel).resolve()
        if S.static_dir not in target.parents and target != S.static_dir:
            return self.fail(404, "Not found")
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self.fail(404, "Not found")
        data = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # ---- api router
    def _api(self, method: str, path: str, qs: dict):
        if path == "/api/config" and method == "GET":
            return self.send_json(200, public_config())

        if path == "/v1/chat/completions" and method == "POST":
            return self._ai(self.read_json())
        if path == "/api/ai/doctor" and method == "POST":
            return self.send_json(200, ai_doctor())
        if path == "/api/ai/models" and method == "GET":
            if not (S.ai_base and (S.ai_key or S.ai_auth == "entra" or not AI_NEEDS_KEY.get(S.ai_provider))):
                return self.send_json(200, {"models": [], "note": "Configure the AI provider in .env first.", "current": S.ai_model})
            return self.send_json(200, ai_models())
        if path == "/v1/models" and method == "GET":
            if not S.ai_enabled:
                raise HttpError(404, "AI is not configured on the relay")
            return self.send_json(200, {"object": "list", "data": [{"id": S.ai_model, "object": "model"}]})

        if path.startswith("/api/vault"):
            return self._vault(method, path, qs)

        if path.startswith("/api/repositories/"):
            provider = (qs.get("provider") or [""])[0]
            if path == "/api/repositories/push" and method == "POST":
                b = self.read_json()
                provider = b.get("provider") or ""
                rel = safe_rel_path(b.get("path") or "")
                md = b.get("markdown")
                if not isinstance(md, str) or not md.strip():
                    raise HttpError(400, "markdown is required")
                msg = str(b.get("message") or "Journal update")[:200]
                mode = str(b.get("mode") or S.publish_mode).lower()
                if mode not in ("commit", "pr"):
                    raise HttpError(400, "mode must be 'commit' or 'pr'")
                opts = {"mode": mode, "knownSha": str(b.get("knownSha") or ""), "force": bool(b.get("force")),
                        "title": str(b.get("title") or msg)[:200], "date": str(b.get("date") or "")[:10],
                        "summary": str(b.get("summary") or "")[:600]}
                return self.send_json(200, self._provider(provider, "push")(rel, md, msg, opts))
            if path == "/api/repositories/delete" and method == "POST":
                b = self.read_json()
                provider = b.get("provider") or ""
                rel = safe_rel_path(b.get("path") or "")
                mode = str(b.get("mode") or S.publish_mode).lower()
                if mode not in ("commit", "pr"):
                    raise HttpError(400, "mode must be 'commit' or 'pr'")
                msg = str(b.get("message") or "Delete journal entry")[:200]
                return self.send_json(200, self._provider(provider, "delete")(rel, msg, {"mode": mode}))
            if path == "/api/repositories/files" and method == "GET":
                return self.send_json(200, {"value": self._provider(provider, "list")()})
            if path == "/api/repositories/content" and method == "GET":
                p = (qs.get("path") or [""])[0]
                md = self._provider(provider, "content")(p)
                return self.send_text(200, rewrite_assets(md, provider, p))
            if path == "/api/repositories/asset" and method == "GET":
                p = (qs.get("path") or [""])[0]
                data = self._provider(provider, "asset")(p)
                ext = p.rsplit(".", 1)[-1].lower()
                self.send_response(200)
                self.send_header("Content-Type", ASSET_TYPES.get(ext, "application/octet-stream"))
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "private, max-age=300")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                self.end_headers()
                self.wfile.write(data)
                return
            if path == "/api/repositories/test" and method == "GET":
                self._provider(provider, "list")  # validates provider + configuration
                return self.send_json(200, repo_test(provider))
            raise HttpError(404, "Not found")

        if path.startswith("/api/workitems"):
            prov = self._track_provider(qs)
            if prov == "github":
                return self._gh_issues(method, path, qs)
            return self._wit(method, path, qs)

        if path.startswith("/api/projects"):
            if not S.gh_projects:
                raise HttpError(404, "GitHub Projects is not configured (DAILY_GITHUB_PROJECT_NUMBER)")
            if path == "/api/projects" and method == "GET":
                return self.send_json(200, gh_project_public(gh_project(force=(qs.get("refresh") or [""])[0] == "1")))
            if path == "/api/projects/item" and method == "POST":
                return self.send_json(200, gh_project_set(self.read_json()))
            if path == "/api/projects/issue" and method == "GET":
                n = wit_id((qs.get("number") or [""])[0])
                p = gh_project()
                it = next((i for i in p["items"] if i["kind"] == "issue" and i["number"] == n
                           and i["repo"].lower() == f"{S.gh_owner}/{S.gh_repo}".lower()), None)
                return self.send_json(200, {"inProject": bool(it), "itemId": (it or {}).get("itemId"),
                                            "status": (it or {}).get("status", ""), "statuses": p["statuses"],
                                            "project": {"title": p["title"], "url": p["url"]}})
            raise HttpError(404, "Not found")

        if path.startswith("/api/runs"):
            prov = (qs.get("provider") or [S.provider_default])[0]
            if prov == "github" and not S.gh_actions or prov == "ado" and not S.ado_pipelines or prov not in ("github", "ado"):
                raise HttpError(404, "Pipeline runs are not enabled for this provider")
            if path == "/api/runs" and method == "GET":
                return self.send_json(200, runs_list(prov))
            if path == "/api/runs/rerun" and method == "POST":
                return self.send_json(200, runs_rerun(prov, self.read_json()))
            raise HttpError(404, "Not found")

        if path.startswith("/api/enterprise/"):
            if not S.ent_enabled:
                raise HttpError(404, "Enterprise features are disabled")
            if path == "/api/enterprise/graph" and method == "GET":
                g = ent_load()
                return self.send_json(200, {"schemaVersion": "1.0", "tenant": "local-enterprise",
                                            "scope": (qs.get("scope") or ["enterprise"])[0],
                                            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                            "nodes": g["nodes"], "edges": g["edges"]})
            if path == "/api/enterprise/ingest" and method == "POST":
                return self.send_json(200, ent_ingest(self.read_json()))
        raise HttpError(404, "Not found")

    def _vault(self, method: str, path: str, qs: dict):
        if path == "/api/vault" and method == "GET":
            if not S.vault_enabled:
                return self.send_json(200, {"enabled": False})
            return self.send_json(200, {"enabled": True, "id": vault_id(), "path": str(S.vault_dir)})
        if not S.vault_enabled:
            raise HttpError(404, "The journal folder is turned off (DAILY_VAULT=false)")
        if path == "/api/vault/list" and method == "GET":
            return self.send_json(200, vault_list())
        if path == "/api/vault/file" and method == "GET":
            return self.send_json(200, vault_read((qs.get("path") or [""])[0]))
        if path == "/api/vault/file" and method == "PUT":
            b = self.read_json()
            content = b.get("content")
            if not isinstance(content, str):
                raise HttpError(400, "content is required")
            try:
                return self.send_json(200, vault_write(b.get("path") or "", content, b.get("ifMatch") if "ifMatch" in b else "*"))
            except Conflict:
                cur = vault_read(b.get("path") or "") if vault_path(b.get("path") or "").exists() else {"etag": None, "content": None}
                return self.send_json(409, {"error": {"message": "The file changed in the journal folder"},
                                            "etag": cur["etag"], "content": cur["content"]})
        if path == "/api/vault/delete" and method == "POST":
            b = self.read_json()
            try:
                return self.send_json(200, vault_delete(b.get("path") or "", b.get("ifMatch") if "ifMatch" in b else "*"))
            except Conflict:
                cur = vault_read(b.get("path") or "")
                return self.send_json(409, {"error": {"message": "The file changed in the journal folder"},
                                            "etag": cur["etag"], "content": cur["content"]})
        raise HttpError(404, "Not found")

    def _provider(self, provider: str, op: str):
        if provider == "github":
            if not S.gh_enabled:
                raise HttpError(404, "GitHub is not configured on the relay")
            return {"push": gh_push, "list": gh_list, "content": gh_content, "asset": gh_asset, "delete": gh_delete}[op]
        if provider == "ado":
            if not S.ado_enabled:
                raise HttpError(404, "Azure DevOps is not configured on the relay")
            return {"push": ado_push, "list": ado_list, "content": ado_content, "asset": ado_asset, "delete": ado_delete}[op]
        raise HttpError(400, "provider must be 'github' or 'ado'")

    def _track_provider(self, qs: dict) -> str:
        prov = (qs.get("provider") or [""])[0]
        if not prov:  # older clients: Azure Boards if it's on, else GitHub Issues
            prov = "ado" if S.wit_enabled else "github"
        if prov == "github" and S.gh_issues or prov == "ado" and S.wit_enabled:
            return prov
        raise HttpError(404, "Issue tracking is not enabled for " + ("GitHub (DAILY_GITHUB_ISSUES_ENABLED)" if prov == "github"
                                                                      else "Azure DevOps (DAILY_ADO_WIT_ENABLED)"))

    def _gh_issues(self, method: str, path: str, qs: dict):
        if path == "/api/workitems/projects" and method == "GET":
            name = f"{S.gh_owner}/{S.gh_repo}"
            return self.send_json(200, {"value": [{"name": name}], "default": name})
        if path == "/api/workitems/types" and method == "GET":
            return self.send_json(200, {"value": [{"name": t} for t in S.gh_issue_types + ["Issue"]]})
        if path == "/api/workitems/query" and method == "POST":
            return self.send_json(200, gh_issue_query(self.read_json()))
        if path == "/api/workitems/comment" and method == "POST":
            b = self.read_json()
            text = html_to_md(str(b.get("text") or "")).strip()
            if not text:
                raise HttpError(400, "text is required")
            j = upstream("POST", f"{gh_base()}/issues/{wit_id(b.get('id'))}/comments", gh_headers(), {"body": text[:65000]})
            return self.send_json(200, {"id": j.get("id"), "url": j.get("html_url", "")})
        if path == "/api/workitems/update" and method == "POST":
            b = self.read_json()
            n = wit_id(b.get("id"))
            fields = b.get("fields")
            if not isinstance(fields, dict) or not fields:
                raise HttpError(400, "fields is required")
            cur = gh_issue_get(n)
            j = upstream("PATCH", f"{gh_base()}/issues/{n}", gh_headers(), gh_issue_payload(fields, cur))
            return self.send_json(200, gh_issue_norm(j, detail=True))
        if path == "/api/workitems" and method == "POST":
            b = self.read_json()
            fields = dict(b.get("fields") or {})
            if not str(fields.get("System.Title") or "").strip():
                raise HttpError(400, "A title is required")
            wtype = str(b.get("type") or "Issue")
            payload = gh_issue_payload(fields, {"labels": [], "body": ""}, wtype)
            payload.setdefault("labels", [gh_type_label(wtype)] if wtype != "Issue" else [])
            if not payload.get("assignees"):
                payload.pop("assignees", None)
            j = upstream("POST", f"{gh_base()}/issues", gh_headers(), payload)
            return self.send_json(200, gh_issue_norm(j, detail=True))
        m = re.fullmatch(r"/api/workitems/(\d+)(/comments)?", path)
        if m and method == "GET":
            n = wit_id(m.group(1))
            if m.group(2):
                lst = upstream("GET", f"{gh_base()}/issues/{n}/comments?per_page=100",
                               {**gh_headers(), "Accept": "application/vnd.github.html+json"})
                return self.send_json(200, {"comments": [{"text": c.get("body_html") or "", "createdDate": c.get("created_at"),
                                                          "createdBy": {"displayName": (c.get("user") or {}).get("login", "")},
                                                          "url": c.get("html_url", "")} for c in lst]})
            return self.send_json(200, gh_issue_norm(gh_issue_get(n), detail=True))
        raise HttpError(404, "Not found")

    def _wit(self, method: str, path: str, qs: dict):
        H = ado_headers()
        org = f"{S.ado_api}/{q(S.ado_org)}"
        if path == "/api/workitems/projects" and method == "GET":
            if not S.wit_multi_project:
                return self.send_json(200, {"value": [{"name": S.ado_project}], "default": S.ado_project})
            j = upstream("GET", f"{org}/_apis/projects?$top=500&api-version=7.1", H)
            names = sorted({p.get("name") for p in j.get("value", []) if p.get("name")})
            if S.wit_projects:
                names = [n for n in names if n in S.wit_projects or n == S.ado_project]
            return self.send_json(200, {"value": [{"name": n} for n in names], "default": S.ado_project})
        if path == "/api/workitems/types" and method == "GET":
            j = upstream("GET", f"{wit_base(wit_project(qs))}/workitemtypes?api-version=7.1", H)
            return self.send_json(200, {"value": [{"name": t.get("name")} for t in j.get("value", [])]})
        if path == "/api/workitems/query" and method == "POST":
            b = self.read_json()
            return self.send_json(200, wit_query(b, wit_project(qs, b)))
        if path == "/api/workitems/comment" and method == "POST":
            b = self.read_json()
            text = str(b.get("text") or "").strip()
            if not text:
                raise HttpError(400, "text is required")
            j = upstream("POST", f"{wit_base(wit_project(qs, b))}/workItems/{wit_id(b.get('id'))}/comments"
                                 f"?api-version=7.1-preview.4", H, {"text": text[:20000]})
            return self.send_json(200, j)
        if path == "/api/workitems/update" and method == "POST":
            b = self.read_json()
            j = upstream("PATCH", f"{wit_base(wit_project(qs, b))}/workitems/{wit_id(b.get('id'))}?api-version=7.1",
                         H, wit_patch(b.get("fields")), content_type="application/json-patch+json")
            return self.send_json(200, j)
        if path == "/api/workitems" and method == "POST":
            b = self.read_json()
            wtype = str(b.get("type") or S.wit_default_type)
            if not PROJECT_RE.match(wtype):
                raise HttpError(400, "Invalid work item type")
            j = upstream("POST", f"{wit_base(wit_project(qs, b))}/workitems/${q(wtype)}?api-version=7.1",
                         H, wit_patch(b.get("fields")), content_type="application/json-patch+json")
            return self.send_json(200, j)
        m = re.fullmatch(r"/api/workitems/(\d+)(/comments)?", path)
        if m and method == "GET":
            base = wit_base(wit_project(qs))
            if m.group(2):
                j = upstream("GET", f"{base}/workItems/{wit_id(m.group(1))}/comments?$top=100&api-version=7.1-preview.4", H)
            else:
                j = upstream("GET", f"{base}/workitems/{wit_id(m.group(1))}?api-version=7.1", H)
            return self.send_json(200, j)
        raise HttpError(404, "Not found")

    def _ai(self, body: dict):
        if not S.ai_enabled:
            missing = ", ".join(S.ai_missing) or "DAILY_AI_ENABLED"
            raise HttpError(404, f"AI is not configured on the relay. Add {missing} to .env and restart the relay.")
        data = {k: v for k, v in body.items() if k in ALLOWED_AI_KEYS}
        if not isinstance(data.get("messages"), list) or not data["messages"]:
            raise HttpError(400, "messages is required")
        stream = bool(data.get("stream"))
        if not stream:
            j, adapted = ai_complete(data)
            payload = json.dumps(j).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            if adapted:
                self.send_header("X-Daily-AI-Adapted", "; ".join(adapted)[:300])
            self._common_headers()
            self.end_headers()
            self.wfile.write(payload)
            return
        resp, _ = ai_request(data)
        with resp:
            ctype = resp.headers.get("Content-Type", "application/json")
            if "event-stream" not in ctype:
                j = json.loads(resp.read() or b"{}")
                payload = json.dumps(ai_to_openai(j) if S.ai_kind == "anthropic" else j).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self._common_headers()
                self.end_headers()
                self.wfile.write(payload)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self._common_headers()
            self.end_headers()
            if S.ai_kind == "anthropic":
                self._anthropic_stream(resp)
            else:
                while True:
                    chunk = resp.read1(8192) if hasattr(resp, "read1") else resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        self.close_connection = True

    def _anthropic_stream(self, resp):
        """Translate Anthropic Messages SSE into Chat Completions SSE."""
        def emit(obj):
            self.wfile.write(b"data: " + json.dumps(obj).encode() + b"\n\n")
            self.wfile.flush()
        buf = b""
        while True:
            chunk = resp.read1(8192) if hasattr(resp, "read1") else resp.read(8192)
            if not chunk:
                break
            buf += chunk.replace(b"\r\n", b"\n")
            while b"\n\n" in buf:
                rec, buf = buf.split(b"\n\n", 1)
                data = b"\n".join(l[5:].lstrip() for l in rec.split(b"\n") if l.startswith(b"data:"))
                if not data:
                    continue
                try:
                    ev = json.loads(data)
                except ValueError:
                    continue
                t = ev.get("type")
                if t == "content_block_delta" and (ev.get("delta") or {}).get("type") == "text_delta":
                    emit({"object": "chat.completion.chunk", "model": S.ai_model,
                          "choices": [{"index": 0, "delta": {"content": ev["delta"].get("text", "")}}]})
                elif t == "message_delta":
                    sr = (ev.get("delta") or {}).get("stop_reason")
                    if sr:
                        emit({"object": "chat.completion.chunk", "model": S.ai_model,
                              "choices": [{"index": 0, "delta": {}, "finish_reason": "length" if sr == "max_tokens" else "stop"}]})
                elif t == "error":
                    emit({"error": {"message": redact(str((ev.get("error") or {}).get("message") or "stream error"))}})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()



# --------------------------------------------------------------------------- journal folder (vault)
#
# The browser keeps the journal in IndexedDB; with the relay running, every entry is also a
# Markdown file in DAILY_VAULT_DIR, laid out like the repository (YYYY/MM/DD/slug--id.md).
# Edits made to those files in another editor flow back into the app. Writes are atomic,
# conditional on an etag (so two writers can't silently clobber each other), and deletes
# move files to .trash/ rather than removing them.

VAULT_SKIP = {".trash", ".git", ".obsidian", ".daily", "node_modules"}
VAULT_META = ".daily-vault.json"
_vault_lock = threading.Lock()


def vault_etag(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:24]


def vault_id() -> str:
    meta = S.vault_dir / VAULT_META
    try:
        return json.loads(meta.read_text("utf-8")).get("id") or ""
    except (OSError, ValueError):
        pass
    S.vault_dir.mkdir(parents=True, exist_ok=True)
    vid = hashlib.sha256(os.urandom(16)).hexdigest()[:16]
    meta.write_text(json.dumps({"id": vid, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "app": "The Daily"}, indent=2) + "\n", "utf-8")
    return vid


def vault_path(rel: str) -> Path:
    if not S.vault_enabled:
        raise HttpError(404, "The journal folder is turned off (DAILY_VAULT=false)")
    rel = safe_rel_path(rel)
    if rel.split("/")[0] in VAULT_SKIP:
        raise HttpError(400, "Invalid path")
    target = (S.vault_dir / rel).resolve()
    if S.vault_dir not in target.parents:
        raise HttpError(403, "Path is outside the journal folder")
    return target


def vault_list() -> dict:
    vid = vault_id()
    files = []
    root = S.vault_dir
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in VAULT_SKIP and not d.startswith(".")]
        for fn in filenames:
            if not fn.lower().endswith(".md") or fn.startswith("."):
                continue
            full = Path(dirpath) / fn
            try:
                if root not in full.resolve().parents:
                    continue
                data = full.read_bytes()
                st = full.stat()
            except OSError:
                continue
            rel = full.relative_to(root).as_posix()
            files.append({"path": rel, "etag": vault_etag(data), "size": len(data), "mtime": int(st.st_mtime * 1000)})
            if len(files) >= 20000:
                break
    files.sort(key=lambda f: f["path"])
    return {"id": vid, "files": files}


def vault_read(rel: str) -> dict:
    p = vault_path(rel)
    try:
        data = p.read_bytes()
    except FileNotFoundError:
        raise HttpError(404, "No such file in the journal folder") from None
    return {"path": safe_rel_path(rel), "etag": vault_etag(data), "content": data.decode("utf-8", "replace")}


def vault_write(rel: str, content: str, if_match) -> dict:
    p = vault_path(rel)
    data = content.encode("utf-8")
    with _vault_lock:
        try:
            cur = p.read_bytes()
        except FileNotFoundError:
            cur = None
        cur_tag = vault_etag(cur) if cur is not None else None
        # if_match: "*" = no check, None = the file must not exist yet, else the expected etag
        if if_match != "*" and (if_match or None) != cur_tag:
            raise Conflict(409, "The file changed in the journal folder")
        if cur is not None and cur == data:
            return {"path": safe_rel_path(rel), "etag": cur_tag, "unchanged": True}
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name("." + p.name + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, p)
    return {"path": safe_rel_path(rel), "etag": vault_etag(data)}


def vault_delete(rel: str, if_match) -> dict:
    p = vault_path(rel)
    with _vault_lock:
        try:
            cur = p.read_bytes()
        except FileNotFoundError:
            return {"path": safe_rel_path(rel), "deleted": False, "missing": True}
        if if_match != "*" and if_match != vault_etag(cur):
            raise Conflict(409, "The file changed in the journal folder")
        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        dest = S.vault_dir / ".trash" / stamp / safe_rel_path(rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(p, dest)
        # tidy empty day/month/year folders
        d = p.parent
        while d != S.vault_dir and S.vault_dir in d.parents:
            try:
                d.rmdir()
            except OSError:
                break
            d = d.parent
    return {"path": safe_rel_path(rel), "deleted": True, "trash": dest.relative_to(S.vault_dir).as_posix()}


def public_config() -> dict:
    """Everything the page needs to switch into relay mode — and nothing secret."""
    return {
        "relay": {"version": VERSION, "clientKeyRequired": bool(S.client_key)},
        "github": {"enabled": S.gh_enabled, "owner": S.gh_owner, "repository": S.gh_repo,
                   "branch": S.gh_branch, "root": S.gh_root} if S.gh_enabled else {"enabled": False},
        "ado": {"enabled": S.ado_enabled, "organization": S.ado_org, "project": S.ado_project,
                "repository": S.ado_repo, "branch": S.ado_branch, "root": S.ado_root} if S.ado_enabled else {"enabled": False},
        "ai": ai_public(),
        "workItems": {"enabled": S.wit_enabled, "organization": S.ado_org if S.wit_enabled else "",
                      "project": S.ado_project if S.wit_enabled else "", "types": S.wit_types,
                      "defaultType": S.wit_default_type, "multiProject": S.wit_multi_project},
        "features": {"enterprise": S.ent_enabled, "enterpriseUI": S.ent_ui},
        "vault": {"enabled": S.vault_enabled},
        "provider": {"default": S.provider_default, "available": S.providers, "mirror": S.mirror,
                     "publishMode": S.publish_mode, "prBranchPrefix": S.pr_prefix, "assets": S.assets},
        "capabilities": {
            "github": {"repo": S.gh_enabled, "pr": S.gh_enabled, "issues": S.gh_issues, "projects": S.gh_projects,
                       "runs": S.gh_actions, "conflicts": S.gh_enabled, "assets": S.gh_enabled and S.assets},
            "ado": {"repo": S.ado_enabled, "pr": S.ado_enabled, "issues": S.wit_enabled, "projects": False,
                    "runs": S.ado_pipelines, "conflicts": S.ado_enabled, "assets": S.ado_enabled and S.assets}},
        "tracking": {
            "github": {"enabled": S.gh_issues, "system": "GitHub", "label": "Issues", "noun": "issue", "refPrefix": "gh",
                       "states": GH_STATES, "types": S.gh_issue_types + ["Issue"], "defaultType": "Issue",
                       "webUrl": f"https://github.com/{S.gh_owner}/{S.gh_repo}/issues/{{id}}" if S.gh_enabled else "",
                       "project": f"{S.gh_owner}/{S.gh_repo}" if S.gh_enabled else "", "organization": S.gh_owner,
                       "multiProject": False, "projects": S.gh_projects, "iterationLabel": "Milestone", "area": False,
                       "tagsLabel": "Labels", "html": False},
            "ado": {"enabled": S.wit_enabled, "system": "Azure DevOps", "label": "Work items", "noun": "work item",
                    "refPrefix": "ado", "states": ["New", "Active", "Resolved", "Closed", "To Do", "In Progress", "Done", "Removed"],
                    "types": S.wit_types, "defaultType": S.wit_default_type,
                    "webUrl": f"{S.ado_web}/{q(S.ado_org)}/_workitems/edit/{{id}}" if S.wit_enabled else "",
                    "project": S.ado_project if S.wit_enabled else "", "organization": S.ado_org if S.wit_enabled else "",
                    "multiProject": S.wit_multi_project, "projects": False, "iterationLabel": "Iteration", "area": True,
                    "tagsLabel": "Tags", "html": True}},
    }


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _safe_console() -> None:
    """Never crash on console encoding (e.g. cp1252 pipes on Windows CI)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass


def main() -> int:
    global S
    _safe_console()
    load_dotenv(Path(os.environ.get("DAILY_ENV_FILE", HERE / ".env")))
    S = Settings()
    if not (S.static_dir / "index.html").is_file():
        print(f"error: {S.static_dir / 'index.html'} not found (DAILY_STATIC_DIR)", file=sys.stderr)
        return 1
    if not is_loopback(S.host) and not S.client_key:
        print("error: refusing to listen on a non-loopback address without DAILY_CLIENT_KEY.\n"
              "       The relay holds your credentials; anyone who can reach it can use them.", file=sys.stderr)
        return 1
    srv = ThreadingHTTPServer((S.host, S.port), Handler)
    srv.daemon_threads = True
    shown = f"[{S.host}]" if ":" in S.host else S.host
    on = lambda b: "on" if b else "off"  # noqa: E731
    print(f"The Daily relay {VERSION}  ->  http://{shown}:{S.port}", flush=True)
    print(f"  Provider: {S.provider_default}{' (mirror on)' if S.mirror else ''} | publish: {S.publish_mode}", flush=True)
    print(f"  GitHub {on(S.gh_enabled)} (issues {on(S.gh_issues)}, projects {on(S.gh_projects)}, actions {on(S.gh_actions)})"
          f" | Azure DevOps {on(S.ado_enabled)} (boards {on(S.wit_enabled)}, pipelines {on(S.ado_pipelines)})", flush=True)
    print(f"  Work items {on(S.wit_enabled)} | Client key {on(bool(S.client_key))}", flush=True)
    print(f"  Journal folder {('on: ' + str(S.vault_dir)) if S.vault_enabled else 'off'}", flush=True)
    if S.ai_enabled:
        host = urllib.parse.urlsplit(S.ai_base).hostname or S.ai_base
        print(f"  AI on: {S.ai_label} | model {S.ai_model} | auth {S.ai_auth} | {host}", flush=True)
    elif S.ai_missing and (S.ai_model or S.ai_key or os.environ.get("DAILY_AI_BASE_URL")):
        print(f"  AI off: missing {', '.join(S.ai_missing)}", flush=True)
    else:
        print("  AI off", flush=True)
    if S.client_key:
        print(f"  First visit: http://{shown}:{S.port}/#relay-key=<your DAILY_CLIENT_KEY>")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
