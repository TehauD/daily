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
import hmac
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

VERSION = "1.0.0"
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

        # AI
        self.ai_provider = env("DAILY_AI_PROVIDER", "openai").lower()  # openai | azure | compatible
        self.ai_base = env("DAILY_AI_BASE_URL", "https://api.openai.com/v1" if self.ai_provider == "openai" else "").rstrip("/")
        self.ai_key = env("DAILY_AI_API_KEY")
        self.ai_model = env("DAILY_AI_MODEL")
        self.ai_version = env("DAILY_AI_API_VERSION", "2024-10-21")
        self.ai_max_tokens = env_int("DAILY_AI_MAX_TOKENS", 4000)
        needs_key = self.ai_provider in ("openai", "azure")
        self.ai_enabled = env_bool("DAILY_AI_ENABLED", True) and bool(self.ai_base and self.ai_model) and (
            bool(self.ai_key) or not needs_key)

        # Enterprise (experimental)
        self.ent_enabled = env_bool("DAILY_ENTERPRISE_ENABLED")
        self.ent_ui = self.ent_enabled and env_bool("DAILY_ENTERPRISE_UI")
        self.data_dir = (HERE / env("DAILY_DATA_DIR", ".daily-data")).resolve()

    def secrets(self) -> list[str]:
        return [s for s in (self.gh_token, self.ado_pat, self.ai_key, self.client_key) if s]


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


# --------------------------------------------------------------------------- GitHub

def gh_headers() -> dict:
    return {"Authorization": f"Bearer {S.gh_token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"}


def gh_base() -> str:
    return f"{S.gh_api}/repos/{q(S.gh_owner)}/{q(S.gh_repo)}"


def gh_push(rel: str, markdown: str, message: str) -> dict:
    path = "/".join(x for x in (S.gh_root, rel) if x)
    url = f"{gh_base()}/contents/{qpath(path)}"
    sha = None
    try:
        sha = upstream("GET", f"{url}?ref={q(S.gh_branch)}", gh_headers()).get("sha")
    except HttpError as e:
        if e.status != 404:
            raise
    body = {"message": message, "content": base64.b64encode(markdown.encode()).decode(), "branch": S.gh_branch}
    if sha:
        body["sha"] = sha
    j = upstream("PUT", url, gh_headers(), body)
    return {"provider": "GitHub", "path": path, "url": (j.get("commit") or {}).get("html_url", "")}


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


def ado_push(rel: str, markdown: str, message: str) -> dict:
    base = ado_repo_base()
    path = "/" + "/".join(x for x in (S.ado_root, rel) if x)
    refs = upstream("GET", f"{base}/refs?filter=heads/{q(S.ado_branch)}&api-version=7.1", ado_headers())
    old = next((r.get("objectId") for r in refs.get("value", []) if r.get("name") == f"refs/heads/{S.ado_branch}"), None)
    if not old:
        raise HttpError(404, f"Azure DevOps branch '{S.ado_branch}' not found")
    exists = True
    try:
        upstream("GET", f"{base}/items?path={q(path)}&versionDescriptor.version={q(S.ado_branch)}"
                        f"&versionDescriptor.versionType=branch&api-version=7.1", ado_headers())
    except HttpError as e:
        if e.status != 404:
            raise
        exists = False
    payload = {"refUpdates": [{"name": f"refs/heads/{S.ado_branch}", "oldObjectId": old}],
               "commits": [{"comment": message, "changes": [{
                   "changeType": "edit" if exists else "add", "item": {"path": path},
                   "newContent": {"content": markdown, "contentType": "rawtext"}}]}]}
    upstream("POST", f"{base}/pushes?api-version=7.1", ado_headers(), payload)
    return {"provider": "Azure DevOps", "path": path}


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

ALLOWED_AI_KEYS = {"messages", "temperature", "max_tokens", "max_completion_tokens", "stream", "top_p",
                   "stop", "response_format", "presence_penalty", "frequency_penalty", "seed"}


def ai_target() -> tuple[str, dict, bool]:
    base = S.ai_base
    h = {}
    if S.ai_provider == "azure":
        if S.ai_key:
            h["api-key"] = S.ai_key
        if base.endswith("/chat/completions"):
            url, include_model = base, "/openai/v1" in base
        elif re.search(r"/openai/v1$", base):
            url, include_model = base + "/chat/completions", True
        else:
            if "/openai/deployments/" not in base:
                base += f"/openai/deployments/{q(S.ai_model)}"
            url, include_model = base + "/chat/completions", False
        if "/openai/v1" not in url:
            url += ("&" if "?" in url else "?") + "api-version=" + q(S.ai_version)
        return url, h, include_model
    if S.ai_key:
        h["Authorization"] = f"Bearer {S.ai_key}"
    if not base.endswith("/chat/completions"):
        if not re.search(r"/v\d+$", base):
            base += "/v1"
        base += "/chat/completions"
    return base, h, True


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Daily-Client-Key, api-key, Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

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
                if not self._key_ok():
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
        if path == "/v1/models" and method == "GET":
            if not S.ai_enabled:
                raise HttpError(404, "AI is not configured on the relay")
            return self.send_json(200, {"object": "list", "data": [{"id": S.ai_model, "object": "model"}]})

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
                return self.send_json(200, self._provider(provider, "push")(rel, md, msg))
            if path == "/api/repositories/files" and method == "GET":
                return self.send_json(200, {"value": self._provider(provider, "list")()})
            if path == "/api/repositories/content" and method == "GET":
                p = (qs.get("path") or [""])[0]
                return self.send_text(200, self._provider(provider, "content")(p))
            raise HttpError(404, "Not found")

        if path.startswith("/api/workitems"):
            if not S.wit_enabled:
                raise HttpError(404, "Work items are not enabled (DAILY_ADO_WIT_ENABLED)")
            return self._wit(method, path, qs)

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

    def _provider(self, provider: str, op: str):
        if provider == "github":
            if not S.gh_enabled:
                raise HttpError(404, "GitHub is not configured on the relay")
            return {"push": gh_push, "list": gh_list, "content": gh_content}[op]
        if provider == "ado":
            if not S.ado_enabled:
                raise HttpError(404, "Azure DevOps is not configured on the relay")
            return {"push": ado_push, "list": ado_list, "content": ado_content}[op]
        raise HttpError(400, "provider must be 'github' or 'ado'")

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
            raise HttpError(404, "AI is not configured on the relay")
        data = {k: v for k, v in body.items() if k in ALLOWED_AI_KEYS}
        if not isinstance(data.get("messages"), list) or not data["messages"]:
            raise HttpError(400, "messages is required")
        for k in ("max_tokens", "max_completion_tokens"):
            if k in data:
                try:
                    data[k] = max(1, min(int(data[k]), S.ai_max_tokens))
                except (TypeError, ValueError):
                    data.pop(k)
        url, headers, include_model = ai_target()
        if include_model:
            data["model"] = S.ai_model  # the relay decides the model, not the browser
        headers.update({"Content-Type": "application/json", "User-Agent": f"the-daily-relay/{VERSION}"})
        stream = bool(data.get("stream"))

        for _attempt in range(3):
            req = urllib.request.Request(url, data=json.dumps(data).encode(), headers=headers, method="POST")
            try:
                resp = urllib.request.urlopen(req, timeout=max(S.timeout, 120))
            except urllib.error.HTTPError as e:
                raw = e.read() or b""
                txt = raw.decode("utf-8", "replace")
                # Newer models reject max_tokens / custom temperature — adapt once and retry.
                if e.code == 400 and "max_tokens" in txt and "max_completion_tokens" in txt and "max_tokens" in data:
                    data["max_completion_tokens"] = data.pop("max_tokens")
                    continue
                if e.code == 400 and "temperature" in txt and "temperature" in data:
                    data.pop("temperature")
                    continue
                try:
                    msg = (json.loads(raw).get("error") or {}).get("message") or ""
                except ValueError:
                    msg = ""
                raise HttpError(e.code, redact(f"AI provider {e.code}" + (f": {msg[:300]}" if msg else ""))) from None
            except urllib.error.URLError as e:
                raise HttpError(502, f"AI provider unreachable: {e.reason}") from None
            break
        else:
            raise HttpError(502, "AI provider rejected the request")

        with resp:
            ctype = resp.headers.get("Content-Type", "application/json")
            if stream and "event-stream" in ctype:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self._common_headers()
                self.end_headers()
                while True:
                    chunk = resp.read1(8192) if hasattr(resp, "read1") else resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
                self.close_connection = True
                return
            payload = resp.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self._common_headers()
        self.end_headers()
        self.wfile.write(payload)


def public_config() -> dict:
    """Everything the page needs to switch into relay mode — and nothing secret."""
    return {
        "relay": {"version": VERSION, "clientKeyRequired": bool(S.client_key)},
        "github": {"enabled": S.gh_enabled, "owner": S.gh_owner, "repository": S.gh_repo,
                   "branch": S.gh_branch, "root": S.gh_root} if S.gh_enabled else {"enabled": False},
        "ado": {"enabled": S.ado_enabled, "organization": S.ado_org, "project": S.ado_project,
                "repository": S.ado_repo, "branch": S.ado_branch, "root": S.ado_root} if S.ado_enabled else {"enabled": False},
        "ai": {"configured": S.ai_enabled, "provider": S.ai_provider, "model": S.ai_model if S.ai_enabled else ""},
        "workItems": {"enabled": S.wit_enabled, "organization": S.ado_org if S.wit_enabled else "",
                      "project": S.ado_project if S.wit_enabled else "", "types": S.wit_types,
                      "defaultType": S.wit_default_type, "multiProject": S.wit_multi_project},
        "features": {"enterprise": S.ent_enabled, "enterpriseUI": S.ent_ui},
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
    print(f"  GitHub {on(S.gh_enabled)} | Azure DevOps {on(S.ado_enabled)} | Work items {on(S.wit_enabled)}"
          f" | AI {on(S.ai_enabled)}{' (' + S.ai_provider + ')' if S.ai_enabled else ''}"
          f" | Client key {on(bool(S.client_key))}", flush=True)
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
