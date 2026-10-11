"""
End-to-end tests for relay.py against a fake GitHub / Azure DevOps / OpenAI server.
No real credentials or network access needed.

    python -m unittest discover -s test -p "test_*.py" -v
"""
import base64
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GH_TOKEN = "ghp_TESTTOKEN_should_never_leak_123456"
ADO_PAT = "adopat_TESTTOKEN_should_never_leak_789"
AI_KEY = "sk-TESTKEY_should_never_leak_abcdef"
PROJ_TOKEN = "ghp_PROJECTS_classic_should_never_leak_42"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start_relay(env, port, timeout=20):
    """Start relay.py and wait until /healthz answers. Output goes to a temp file
    (a never-read PIPE can fill up and block the child, notably on Windows).
    Fails fast with the relay's own output if it exits or never comes up."""
    import tempfile
    env = dict(env)
    # Mimic a Windows CI pipe on every OS so console-encoding crashes are caught.
    env["PYTHONIOENCODING"] = "cp1252"
    log = tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace")
    proc = subprocess.Popen([sys.executable, str(ROOT / "relay.py")], env=env, stdout=log, stderr=subprocess.STDOUT)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        try:
            opener.open(f"http://127.0.0.1:{port}/healthz", timeout=1)
            return proc, log
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    if proc.poll() is None:
        proc.kill()
    proc.wait(timeout=5)
    log.seek(0)
    raise RuntimeError(f"relay.py did not start (exit code {proc.returncode}). Output:\n{log.read()}")


def stop_relay(proc, log):
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    log.seek(0)
    out = log.read()
    log.close()
    return out


def blob_sha(data: bytes) -> str:
    import hashlib
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


class Fake:
    """In-memory upstream state shared with the handler (GitHub + Azure DevOps + OpenAI)."""
    gh = {"main": {}}             # branch -> {path: bytes}
    gh_refs = {"main": "c0"}      # branch -> commit sha
    gh_pulls = []                 # [{number, head, base, title}]
    gh_issues = {}                # number -> issue json
    gh_comments = {}              # number -> [comment]
    gh_search = []                # recorded search queries
    gh_graphql = []               # recorded GraphQL operations
    gh_rerun = []
    ado = {"main": {}}            # branch -> {path(leading /): bytes}
    ado_refs = {"main": "abc"}
    ado_pushes = []
    ado_prs = []
    ado_builds = []
    ai_requests = []
    auth_seen = []
    wit = {}
    ai_reject_max_tokens = False

    @classmethod
    def gh_text(cls, path, branch="main"):
        v = cls.gh.get(branch, {}).get(path)
        return v.decode() if v is not None else None

    @classmethod
    def ado_text(cls, path, branch="main"):
        v = cls.ado.get(branch, {}).get(path)
        return v.decode() if v is not None else None


def _issue(n, title, labels=(), state="open", reason=None, body="", assignee=None, milestone=None):
    return {"number": n, "node_id": f"I_{n}", "title": title, "state": state, "state_reason": reason, "body": body,
            "labels": [{"name": l} for l in labels], "assignees": [{"login": assignee}] if assignee else [],
            "milestone": {"title": milestone} if milestone else None, "user": {"login": "me"},
            "created_at": "2026-10-01T00:00:00Z", "updated_at": "2026-10-02T00:00:00Z",
            "html_url": f"https://github.com/me/journal/issues/{n}"}


class FakeUpstream(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj, ctype="application/json"):
        data = json.dumps(obj).encode() if not isinstance(obj, (bytes, str)) else (obj.encode() if isinstance(obj, str) else obj)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def handle_any(self):
        Fake.auth_seen.append(self.headers.get("Authorization") or self.headers.get("api-key") or "")
        u = urllib.parse.urlsplit(self.path)
        p, qs = u.path, urllib.parse.parse_qs(u.query)
        R = "/gh/repos/me/journal"
        # ---------- GitHub: repository
        if p == R and self.command == "GET":
            return self._json(200, {"full_name": "me/journal", "private": True, "default_branch": "main",
                                    "permissions": {"push": True}, "html_url": "https://github.com/me/journal"})
        if p.startswith(R + "/contents/"):
            path = urllib.parse.unquote(p.split("/contents/", 1)[1])
            if self.command == "GET":
                br = (qs.get("ref") or ["main"])[0]
                data = Fake.gh.get(br, {}).get(path)
                if data is None:
                    return self._json(404, {"message": "Not Found"})
                if "raw" in (self.headers.get("Accept") or ""):
                    return self._json(200, data, "application/octet-stream")
                return self._json(200, {"sha": blob_sha(data), "encoding": "base64", "content": base64.b64encode(data).decode()})
            if self.command == "PUT":
                b = self._body()
                br = b.get("branch", "main")
                cur = Fake.gh.get(br, {}).get(path)
                if cur is not None and b.get("sha") != blob_sha(cur):
                    return self._json(409, {"message": "sha mismatch"})
                data = base64.b64decode(b["content"])
                Fake.gh.setdefault(br, {})[path] = data
                return self._json(201, {"content": {"sha": blob_sha(data)}, "commit": {"html_url": "https://github.example/c/1"}})
            if self.command == "DELETE":
                b = self._body()
                br = b.get("branch", "main")
                cur = Fake.gh.get(br, {}).get(path)
                if cur is None:
                    return self._json(404, {"message": "Not Found"})
                if b.get("sha") != blob_sha(cur):
                    return self._json(409, {"message": "sha mismatch"})
                del Fake.gh[br][path]
                return self._json(200, {"commit": {"sha": "del1"}})
        if p.startswith(R + "/git/ref/heads/"):
            br = urllib.parse.unquote(p.split("/git/ref/heads/", 1)[1])
            if br in Fake.gh_refs:
                return self._json(200, {"object": {"sha": Fake.gh_refs[br]}})
            return self._json(404, {"message": "Not Found"})
        if p == R + "/git/refs" and self.command == "POST":
            b = self._body()
            br = b["ref"].replace("refs/heads/", "")
            Fake.gh_refs[br] = b["sha"]
            Fake.gh[br] = dict(Fake.gh.get("main", {}))
            return self._json(201, {"ref": b["ref"]})
        if p.startswith(R + "/git/trees/"):
            return self._json(200, {"tree": [{"type": "blob", "path": k, "sha": blob_sha(v)} for k, v in Fake.gh["main"].items()]
                                    + [{"type": "blob", "path": "README.md", "sha": "x"}]})
        if p == R + "/pulls":
            if self.command == "POST":
                b = self._body()
                if any(x["head"] == b["head"] for x in Fake.gh_pulls):
                    return self._json(422, {"message": "A pull request already exists"})
                pr = {"number": len(Fake.gh_pulls) + 7, "head": b["head"], "base": b["base"], "title": b["title"]}
                Fake.gh_pulls.append(pr)
                return self._json(201, {"number": pr["number"], "html_url": f"https://github.com/me/journal/pull/{pr['number']}"})
            head = (qs.get("head") or [""])[0].split(":", 1)[-1]
            return self._json(200, [{"number": x["number"], "html_url": f"https://github.com/me/journal/pull/{x['number']}"}
                                    for x in Fake.gh_pulls if x["head"] == head])
        # ---------- GitHub: issues, search, markdown
        if p == "/gh/search/issues":
            q = qs["q"][0]
            Fake.gh_search.append(q)
            items = [i for i in Fake.gh_issues.values() if ("is:closed" in q) == (i["state"] == "closed")]
            items.append({**_issue(999, "a pull request"), "pull_request": {}})
            return self._json(200, {"items": items})
        if p == "/gh/markdown" and self.command == "POST":
            return self._json(200, "<p>" + self._body()["text"] + "</p>", "text/html")
        if p == R + "/issues" and self.command == "POST":
            b = self._body()
            n = 40 + len(Fake.gh_issues)
            Fake.gh_issues[n] = _issue(n, b["title"], b.get("labels") or [], body=b.get("body") or "",
                                       assignee=(b.get("assignees") or [None])[0])
            Fake.wit["gh_created"] = b
            return self._json(201, Fake.gh_issues[n])
        m = re.fullmatch(R + r"/issues/(\d+)(/comments)?", p)
        if m:
            n = int(m.group(1))
            if n not in Fake.gh_issues:
                return self._json(404, {"message": "Not Found"})
            if m.group(2):
                if self.command == "POST":
                    Fake.gh_comments.setdefault(n, []).append(self._body()["body"])
                    return self._json(201, {"id": 1, "html_url": "c"})
                return self._json(200, [{"body_html": "<p>" + c + "</p>", "created_at": "2026-10-03T00:00:00Z",
                                         "user": {"login": "me"}} for c in Fake.gh_comments.get(n, [])])
            if self.command == "PATCH":
                b = self._body()
                Fake.wit["gh_patch"] = b
                i = Fake.gh_issues[n]
                if "labels" in b:
                    i["labels"] = [{"name": l} for l in b["labels"]]
                for k in ("title", "state", "state_reason", "body"):
                    if k in b:
                        i[k] = b[k]
                if "assignees" in b:
                    i["assignees"] = [{"login": a} for a in b["assignees"]]
            return self._json(200, Fake.gh_issues[n])
        # ---------- GitHub: Actions
        if p == R + "/actions/runs":
            return self._json(200, {"workflow_runs": [
                {"id": 9, "name": "CI", "display_title": "Journal 2026-10-10", "status": "completed", "conclusion": "failure",
                 "head_branch": "main", "event": "push", "head_sha": "abcdef1234", "run_started_at": "2026-10-10T10:00:00Z",
                 "updated_at": "2026-10-10T10:02:00Z", "html_url": "https://github.com/me/journal/actions/runs/9",
                 "actor": {"login": "me"}, "run_attempt": 1}]})
        m = re.fullmatch(R + r"/actions/runs/(\d+)/(rerun|rerun-failed-jobs)", p)
        if m and self.command == "POST":
            Fake.gh_rerun.append((int(m.group(1)), m.group(2)))
            return self._json(201, {})
        # ---------- GitHub: Projects (GraphQL)
        if p == "/gh/graphql" and self.command == "POST":
            b = self._body()
            Fake.gh_graphql.append((b["query"].split("(", 1)[0].strip(), b["variables"]))
            if "addProjectV2ItemById" in b["query"]:
                return self._json(200, {"data": {"addProjectV2ItemById": {"item": {"id": "PVTI_new"}}}})
            if "updateProjectV2ItemFieldValue" in b["query"]:
                return self._json(200, {"data": {"updateProjectV2ItemFieldValue": {"projectV2Item": {"id": b["variables"]["i"]}}}})
            proj = {"id": "PVT_1", "title": "Journal board", "url": "https://github.com/users/me/projects/3", "number": 3,
                    "field": {"id": "PVTSSF_1", "options": [{"id": "o1", "name": "Todo"}, {"id": "o2", "name": "In Progress"},
                                                             {"id": "o3", "name": "Done"}]},
                    "items": {"nodes": [{"id": "PVTI_5", "fieldValueByName": {"name": "In Progress", "optionId": "o2"},
                                         "content": {"__typename": "Issue", "number": 5, "title": "Wire the relay", "state": "OPEN",
                                                     "url": "u", "repository": {"nameWithOwner": "me/journal"}}},
                                        {"id": "PVTI_d", "fieldValueByName": None,
                                         "content": {"__typename": "DraftIssue", "title": "Idea"}}]}}
            return self._json(200, {"data": {"user": {"projectV2": proj}, "organization": None},
                                    "errors": [{"type": "NOT_FOUND", "message": "Could not resolve to an Organization"}]})
        # ---------- Azure DevOps repos
        base = "/ado/org1/proj1/_apis/git/repositories/repo1"
        if p == base:
            return self._json(200, {"name": "repo1", "project": {"name": "proj1"}, "defaultBranch": "refs/heads/main"})
        if p.startswith(base + "/refs"):
            want = (qs.get("filter") or ["heads/"])[0].replace("heads/", "")
            return self._json(200, {"value": [{"name": "refs/heads/" + br, "objectId": oid}
                                              for br, oid in Fake.ado_refs.items() if br.startswith(want)]})
        if p.startswith(base + "/pushes"):
            b = self._body()
            ref = b["refUpdates"][0]
            br = ref["name"].replace("refs/heads/", "")
            if ref["oldObjectId"] == "0" * 40:
                if br in Fake.ado_refs:
                    return self._json(409, {"message": "branch exists"})
                Fake.ado[br] = dict(Fake.ado["main"])
            elif Fake.ado_refs.get(br) != ref["oldObjectId"]:
                return self._json(409, {"message": "TF401028: ref has been updated"})
            Fake.ado_pushes.append(b)
            for ch in b["commits"][0]["changes"]:
                if ch["changeType"] == "delete":
                    Fake.ado.setdefault(br, {}).pop(ch["item"]["path"], None)
                    continue
                c = ch["newContent"]
                data = base64.b64decode(c["content"]) if c["contentType"] == "base64encoded" else c["content"].encode()
                Fake.ado.setdefault(br, {})[ch["item"]["path"]] = data
            Fake.ado_refs[br] = "c%d" % len(Fake.ado_pushes)
            return self._json(201, {"pushId": len(Fake.ado_pushes)})
        if p.startswith(base + "/items"):
            if "scopePath" in qs:
                return self._json(200, {"value": [{"path": k, "isFolder": False, "objectId": blob_sha(v)}
                                                  for k, v in Fake.ado["main"].items() if k.endswith(".md")]})
            path = qs["path"][0]
            br = (qs.get("versionDescriptor.version") or ["main"])[0]
            data = Fake.ado.get(br, {}).get(path)
            if data is None:
                return self._json(404, {"message": "not found"})
            fmt = (qs.get("$format") or [""])[0]
            if fmt == "json":
                return self._json(200, {"objectId": blob_sha(data), "path": path})
            return self._json(200, data, "application/octet-stream" if fmt == "octetStream" else "text/plain")
        if p == base + "/pullrequests":
            if self.command == "POST":
                b = self._body()
                if any(x["sourceRefName"] == b["sourceRefName"] for x in Fake.ado_prs):
                    return self._json(409, {"message": "TF401179: An active pull request already exists"})
                b["pullRequestId"] = 11 + len(Fake.ado_prs)
                Fake.ado_prs.append(b)
                return self._json(201, b)
            src = (qs.get("searchCriteria.sourceRefName") or [""])[0]
            return self._json(200, {"value": [x for x in Fake.ado_prs if x["sourceRefName"] == src]})
        # ---------- Azure Pipelines
        if p == "/ado/org1/proj1/_apis/build/builds":
            if self.command == "POST":
                b = self._body()
                Fake.ado_builds.append(b)
                return self._json(200, {"id": 600 + len(Fake.ado_builds)})
            return self._json(200, {"value": [{"id": 501, "definition": {"id": 4, "name": "journal-ci"}, "buildNumber": "20261010.1",
                                               "status": "completed", "result": "partiallySucceeded", "sourceBranch": "refs/heads/main",
                                               "reason": "individualCI", "sourceVersion": "1234567890", "startTime": "2026-10-10T10:00:00Z",
                                               "finishTime": "2026-10-10T10:05:00Z", "_links": {"web": {"href": "https://dev.azure.com/b/501"}},
                                               "requestedFor": {"displayName": "Me"}}]})
        if p == "/ado/org1/proj1/_apis/build/builds/501":
            return self._json(200, {"id": 501, "definition": {"id": 4}, "sourceBranch": "refs/heads/main"})
        # ---------- Azure Boards
        if p.startswith("/ado/org1/_apis/projects"):
            return self._json(200, {"value": [{"name": "proj1"}, {"name": "proj2"}]})
        if "/_apis/wit/wiql" in p:
            Fake.wit["last_wiql"] = self._body()["query"]
            return self._json(200, {"workItems": [{"id": 7}, {"id": 3}]})
        if "/_apis/wit/workitemsbatch" in p:
            return self._json(200, {"value": [{"id": 3, "fields": {}}, {"id": 7, "fields": {}}]})
        if "/_apis/wit/workitems/$" in p and self.command == "POST":
            ops = self._body()
            Fake.wit["created"] = (self.path, ops, self.headers.get("Content-Type"))
            return self._json(200, {"id": 99, "fields": {o["path"][8:]: o["value"] for o in ops}})
        if "/_apis/wit/workitems/" in p and self.command == "PATCH":
            Fake.wit["updated"] = self._body()
            return self._json(200, {"id": 7, "fields": {}})
        if "/_apis/wit/workItems/7/comments" in p:
            if self.command == "POST":
                Fake.wit["comment"] = self._body()
            return self._json(200, {"comments": [{"text": "hi", "createdDate": "2026-01-01"}]})
        # ---------- OpenAI-compatible
        if p.startswith("/ai/v1/chat/completions"):
            b = self._body()
            Fake.ai_requests.append(b)
            if Fake.ai_reject_max_tokens and "max_tokens" in b:
                return self._json(400, {"error": {"message": "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead."}})
            if b.get("stream"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for t in ("Hel", "lo"):
                    self.wfile.write(f'data: {json.dumps({"choices": [{"delta": {"content": t}}]})}\n\n'.encode())
                    self.wfile.flush()
                self.wfile.write(b"data: [DONE]\n\n")
                return
            return self._json(200, {"choices": [{"message": {"content": "Hello from fake AI"}}]})
        return self._json(404, {"message": "fake: no route " + self.path})

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any


import urllib.parse  # noqa: E402  (used by the fake handler)


class RelayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import tempfile
        cls.vault_tmp = tempfile.TemporaryDirectory()
        cls.up = ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream)
        threading.Thread(target=cls.up.serve_forever, daemon=True).start()
        up = f"http://127.0.0.1:{cls.up.server_address[1]}"
        cls.port = free_port()
        cls.base = f"http://127.0.0.1:{cls.port}"
        envs = {
            "DAILY_ENV_FILE": "/nonexistent",
            "DAILY_PORT": str(cls.port),
            "DAILY_GITHUB_TOKEN": GH_TOKEN, "DAILY_GITHUB_OWNER": "me", "DAILY_GITHUB_REPOSITORY": "journal",
            "DAILY_GITHUB_ROOT": "journal", "DAILY_GITHUB_API_URL": up + "/gh",
            "DAILY_ADO_ENABLED": "true", "DAILY_ADO_WIT_ENABLED": "true", "DAILY_ADO_PAT": ADO_PAT,
            "DAILY_ADO_ORGANIZATION": "org1", "DAILY_ADO_PROJECT": "proj1", "DAILY_ADO_REPOSITORY": "repo1",
            "DAILY_ADO_ROOT": "journal", "DAILY_ADO_API_URL": up + "/ado",
            "DAILY_AI_PROVIDER": "compatible", "DAILY_AI_BASE_URL": up + "/ai/v1", "DAILY_AI_API_KEY": AI_KEY,
            "DAILY_AI_MODEL": "gpt-test", "DAILY_AI_MAX_TOKENS": "500",
            "DAILY_PROVIDER": "github", "DAILY_GITHUB_PROJECT_NUMBER": "3",
            "DAILY_GITHUB_PROJECTS_TOKEN": PROJ_TOKEN,
            "DAILY_VAULT_DIR": cls.vault_tmp.name,
        }
        env = {k: v for k, v in os.environ.items() if not k.startswith("DAILY_")}
        env.update(envs)
        env["NO_PROXY"] = env["no_proxy"] = "127.0.0.1,localhost"
        try:
            cls.proc, cls.logf = start_relay(env, cls.port)
        except Exception:
            cls.up.shutdown()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.log = stop_relay(cls.proc, cls.logf)
        cls.up.shutdown()
        cls.vault_tmp.cleanup()
        for s in (GH_TOKEN, ADO_PAT, AI_KEY, PROJ_TOKEN):
            assert s not in cls.log, "secret leaked into relay log"

    # ------------------------------------------------------------- helpers
    def req(self, method, path, body=None, headers=None, raw=False):
        h = {"Content-Type": "application/json"}
        h.update(headers or {})
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(r, timeout=10) as resp:
                out = resp.read()
                return resp.status, (out if raw else json.loads(out or b"{}")), dict(resp.headers)
        except urllib.error.HTTPError as e:
            out = e.read()
            try:
                return e.code, json.loads(out), dict(e.headers)
            except ValueError:
                return e.code, out, dict(e.headers)

    # ------------------------------------------------------------- tests
    def test_static_and_headers(self):
        code, body, h = self.req("GET", "/", raw=True)
        self.assertEqual(code, 200)
        self.assertIn(b"The Daily", body)
        self.assertIn("frame-ancestors 'none'", h["Content-Security-Policy"])

    def test_static_traversal_blocked(self):
        code, _, _ = self.req("GET", "/..%2frelay.py", raw=True)
        self.assertEqual(code, 404)
        code, _, _ = self.req("GET", "/../.env", raw=True)
        self.assertEqual(code, 404)

    def test_config_has_no_secrets(self):
        code, cfg, _ = self.req("GET", "/api/config")
        self.assertEqual(code, 200)
        dump = json.dumps(cfg)
        for s in (GH_TOKEN, ADO_PAT, AI_KEY):
            self.assertNotIn(s, dump)
        self.assertTrue(cfg["github"]["enabled"])
        self.assertTrue(cfg["ado"]["enabled"])
        self.assertTrue(cfg["ai"]["configured"])
        self.assertTrue(cfg["workItems"]["enabled"])

    def test_github_roundtrip(self):
        code, j, _ = self.req("POST", "/api/repositories/push",
                              {"provider": "github", "path": "2026/10/04/hello--abc.md", "markdown": "# Hi", "message": "m"})
        self.assertEqual(code, 200, j)
        self.assertEqual(j["provider"], "GitHub")
        self.assertEqual(Fake.gh_text("journal/2026/10/04/hello--abc.md"), "# Hi")
        code, files, _ = self.req("GET", "/api/repositories/files?provider=github")
        self.assertIn("journal/2026/10/04/hello--abc.md", [f["path"] for f in files["value"]])
        self.assertNotIn("README.md", [f["path"] for f in files["value"]])
        code, text, _ = self.req("GET", "/api/repositories/content?provider=github&path=journal/2026/10/04/hello--abc.md", raw=True)
        self.assertEqual(text.decode(), "# Hi")
        self.assertIn("Bearer " + GH_TOKEN, Fake.auth_seen)

    def test_ado_roundtrip(self):
        code, j, _ = self.req("POST", "/api/repositories/push",
                              {"provider": "ado", "path": "2026/10/04/x--1.md", "markdown": "# ADO", "message": "m"})
        self.assertEqual(code, 200, j)
        self.assertEqual(Fake.ado_text("/journal/2026/10/04/x--1.md"), "# ADO")
        code, files, _ = self.req("GET", "/api/repositories/files?provider=ado")
        self.assertIn("/journal/2026/10/04/x--1.md", [f["path"] for f in files["value"]])
        code, text, _ = self.req("GET", "/api/repositories/content?provider=ado&path=/journal/2026/10/04/x--1.md", raw=True)
        self.assertEqual(text.decode(), "# ADO")

    # ------------------------------------------------------------- provider model + capabilities
    def test_config_provider_and_capabilities(self):
        code, cfg, _ = self.req("GET", "/api/config")
        self.assertEqual(cfg["provider"]["default"], "github")
        self.assertEqual(sorted(cfg["provider"]["available"]), ["ado", "github"])
        gh, ado = cfg["capabilities"]["github"], cfg["capabilities"]["ado"]
        self.assertTrue(gh["issues"] and gh["projects"] and gh["runs"] and gh["pr"])
        self.assertTrue(ado["issues"] and ado["runs"] and ado["pr"])
        self.assertFalse(ado["projects"])
        self.assertEqual(cfg["tracking"]["github"]["refPrefix"], "gh")
        self.assertEqual(cfg["tracking"]["ado"]["refPrefix"], "ado")
        self.assertIn("Not planned", cfg["tracking"]["github"]["states"])
        self.assertNotIn(PROJ_TOKEN, json.dumps(cfg))

    def test_repository_test_endpoint(self):
        code, j, _ = self.req("GET", "/api/repositories/test?provider=github")
        self.assertEqual((code, j["name"], j["branchExists"], j["canPush"]), (200, "me/journal", True, True))
        code, j, _ = self.req("GET", "/api/repositories/test?provider=ado")
        self.assertEqual((code, j["name"], j["project"], j["branchExists"]), (200, "repo1", "proj1", True))

    # ------------------------------------------------------------- conflicts (relay mode used to overwrite silently)
    def test_github_conflict_detection(self):
        body = {"provider": "github", "path": "2026/10/05/c--1.md", "markdown": "v1", "message": "m"}
        code, j, _ = self.req("POST", "/api/repositories/push", body)
        sha1 = j["sha"]
        self.assertEqual(code, 200)
        Fake.gh["main"]["journal/2026/10/05/c--1.md"] = b"edited on github.com"
        code, j, _ = self.req("POST", "/api/repositories/push", {**body, "markdown": "v2", "knownSha": sha1})
        self.assertEqual(code, 409)
        self.assertIn("REMOTE_CHANGED", j["error"]["message"])
        code, j, _ = self.req("POST", "/api/repositories/push", {**body, "markdown": "v2", "knownSha": sha1, "force": True})
        self.assertEqual(code, 200, j)
        self.assertEqual(Fake.gh_text("journal/2026/10/05/c--1.md"), "v2")
        code, j2, _ = self.req("POST", "/api/repositories/push", {**body, "markdown": "v2", "knownSha": j["sha"]})
        self.assertTrue(j2["unchanged"])

    def test_ado_conflict_detection(self):
        body = {"provider": "ado", "path": "2026/10/05/c--2.md", "markdown": "v1", "message": "m"}
        code, j, _ = self.req("POST", "/api/repositories/push", body)
        self.assertEqual(code, 200, j)
        self.assertTrue(j["sha"])
        Fake.ado["main"]["/journal/2026/10/05/c--2.md"] = b"edited in Azure Repos"
        code, j2, _ = self.req("POST", "/api/repositories/push", {**body, "markdown": "v2", "knownSha": j["sha"]})
        self.assertEqual(code, 409)

    # ------------------------------------------------------------- publish via pull request
    def test_github_pull_request_mode(self):
        body = {"provider": "github", "path": "2026/10/10/review-me--pr1.md", "markdown": "# Draft", "message": "Journal",
                "mode": "pr", "title": "Journal 2026-10-10 - Review me", "date": "2026-10-10"}
        code, j, _ = self.req("POST", "/api/repositories/push", body)
        self.assertEqual(code, 200, j)
        self.assertEqual(j["branch"], "journal/2026-10-10-review-me--pr1")
        self.assertEqual(Fake.gh_text("journal/2026/10/10/review-me--pr1.md", j["branch"]), "# Draft")
        self.assertIsNone(Fake.gh_text("journal/2026/10/10/review-me--pr1.md"))  # main untouched
        self.assertFalse(j["pr"]["existing"])
        self.assertIn("/pull/", j["pr"]["url"])
        code, j2, _ = self.req("POST", "/api/repositories/push", {**body, "markdown": "# Draft v2"})
        self.assertEqual(code, 200, j2)
        self.assertTrue(j2["pr"]["existing"])
        self.assertEqual(j2["pr"]["number"], j["pr"]["number"])

    def test_ado_pull_request_mode(self):
        body = {"provider": "ado", "path": "2026/10/10/review-me--pr2.md", "markdown": "# ADO draft", "message": "Journal",
                "mode": "pr", "title": "Journal - review"}
        code, j, _ = self.req("POST", "/api/repositories/push", body)
        self.assertEqual(code, 200, j)
        push = Fake.ado_pushes[-1]
        self.assertEqual(push["refUpdates"][0]["oldObjectId"], "0" * 40)   # new branch...
        self.assertTrue(push["commits"][0]["parents"])                      # ...on top of main
        self.assertEqual(Fake.ado_text("/journal/2026/10/10/review-me--pr2.md", j["branch"]), "# ADO draft")
        self.assertEqual(Fake.ado_prs[-1]["targetRefName"], "refs/heads/main")
        self.assertIn("/pullrequest/", j["pr"]["url"])
        code, j2, _ = self.req("POST", "/api/repositories/push", {**body, "markdown": "# ADO draft v2"})
        self.assertEqual(code, 200, j2)
        self.assertTrue(j2["pr"]["existing"])
        self.assertNotEqual(Fake.ado_pushes[-1]["refUpdates"][0]["oldObjectId"], "0" * 40)

    # ------------------------------------------------------------- images: assets/ for both providers, viewable in the app
    PNG = base64.b64encode(b"\x89PNG\r\n\x1a\nfake-png-bytes").decode()

    def test_assets_github(self):
        md = f"# Pic\n\n![shot](data:image/png;base64,{self.PNG})\n\nagain ![same](data:image/png;base64,{self.PNG})"
        code, j, _ = self.req("POST", "/api/repositories/push", {"provider": "github", "path": "2026/10/06/pic--a1.md", "markdown": md})
        self.assertEqual((code, j["assets"]), (200, 1), j)
        saved = Fake.gh_text("journal/2026/10/06/pic--a1.md")
        self.assertEqual(saved.count("](assets/pic--a1-1.png)"), 2)
        self.assertNotIn("data:image", saved)
        self.assertTrue(Fake.gh["main"]["journal/2026/10/06/assets/pic--a1-1.png"].startswith(b"\x89PNG"))
        code, text, _ = self.req("GET", "/api/repositories/content?provider=github&path=journal/2026/10/06/pic--a1.md", raw=True)
        url = "/api/repositories/asset?provider=github&path=journal%2F2026%2F10%2F06%2Fassets%2Fpic--a1-1.png"
        self.assertIn(url, text.decode())
        code, img, h = self.req("GET", url, raw=True)
        self.assertEqual((code, h["Content-Type"]), (200, "image/png"))
        self.assertTrue(img.startswith(b"\x89PNG"))
        # pushing the pulled text back must restore relative links, not relay URLs
        code, j, _ = self.req("POST", "/api/repositories/push", {"provider": "github", "path": "2026/10/06/pic--a1.md",
                                                                 "markdown": text.decode() + "\nmore"})
        self.assertNotIn("/api/repositories/asset", Fake.gh_text("journal/2026/10/06/pic--a1.md"))
        code, _, _ = self.req("GET", "/api/repositories/asset?provider=github&path=journal%2F..%2Fsecrets%2Fassets%2Fx.png")
        self.assertEqual(code, 400)
        code, _, _ = self.req("GET", "/api/repositories/asset?provider=github&path=other%2Fassets%2Fx.png")
        self.assertEqual(code, 403)

    def test_assets_ado(self):
        md = f"![d](data:image/png;base64,{self.PNG})"
        code, j, _ = self.req("POST", "/api/repositories/push", {"provider": "ado", "path": "2026/10/06/pic--b2.md", "markdown": md})
        self.assertEqual((code, j["assets"]), (200, 1), j)
        changes = Fake.ado_pushes[-1]["commits"][0]["changes"]
        self.assertEqual([c["newContent"]["contentType"] for c in changes], ["base64encoded", "rawtext"])
        self.assertTrue(Fake.ado["main"]["/journal/2026/10/06/assets/pic--b2-1.png"].startswith(b"\x89PNG"))
        code, img, h = self.req("GET", "/api/repositories/asset?provider=ado&path=journal%2F2026%2F10%2F06%2Fassets%2Fpic--b2-1.png", raw=True)
        self.assertEqual((code, h["Content-Type"]), (200, "image/png"))

    # ------------------------------------------------------------- GitHub Issues through the work-item contract
    def test_github_issues(self):
        Fake.gh_issues[5] = _issue(5, "Wire the relay", ["bug", "P2", "relay"], body="Do it.\n\n## Acceptance criteria\n\n- works",
                                   assignee="me", milestone="October")
        code, j, _ = self.req("POST", "/api/workitems/query?provider=github",
                              {"states": ["Open"], "types": ["Bug"], "assignedToMe": True, "search": "relay"})
        self.assertEqual(code, 200, j)
        q = Fake.gh_search[-1]
        for part in ("repo:me/journal", "is:issue", "is:open", 'label:"bug"', "assignee:@me", "relay in:title"):
            self.assertIn(part, q)
        self.assertEqual([i["id"] for i in j["value"]], [5])  # the pull request result is filtered out
        f = j["value"][0]["fields"]
        self.assertEqual((f["System.WorkItemType"], f["System.State"], f["Microsoft.VSTS.Common.Priority"], f["System.Tags"],
                          f["System.IterationPath"]), ("Bug", "Open", 2, "relay", "October"))
        code, it, _ = self.req("GET", "/api/workitems/5?provider=github")
        self.assertEqual(it["fields"]["System.Description"], "<p>Do it.</p>")
        self.assertEqual(it["fields"]["Microsoft.VSTS.Common.AcceptanceCriteria"], "<p>- works</p>")
        # state, labels, priority, assignee, acceptance criteria
        code, it, _ = self.req("POST", "/api/workitems/update?provider=github", {"id": 5, "fields": {
            "System.State": "Not planned", "Microsoft.VSTS.Common.Priority": 1, "System.Tags": "relay; docs",
            "System.AssignedTo": "Unassigned", "Microsoft.VSTS.Common.AcceptanceCriteria": "<ul><li>a</li><li>b</li></ul>"}})
        self.assertEqual(code, 200, it)
        patch = Fake.wit["gh_patch"]
        self.assertEqual((patch["state"], patch["state_reason"]), ("closed", "not_planned"))
        self.assertEqual(patch["labels"], ["bug", "P1", "relay", "docs"])
        self.assertEqual(patch["assignees"], [])
        self.assertEqual(patch["body"], "Do it.\n\n## Acceptance criteria\n\n- a\n- b")
        self.assertEqual(it["fields"]["System.State"], "Not planned")
        code, it, _ = self.req("POST", "/api/workitems/update?provider=github", {"id": 5, "fields": {"System.State": "Sideways"}})
        self.assertEqual(code, 400)
        # create with type + priority labels; comment as Markdown
        code, it, _ = self.req("POST", "/api/workitems?provider=github", {"type": "Feature", "fields": {
            "System.Title": "Draft from entry", "Microsoft.VSTS.Common.Priority": 3, "System.Tags": "the-daily",
            "System.Description": "Line one<br>Line two"}})
        self.assertEqual(code, 200, it)
        self.assertEqual(Fake.wit["gh_created"]["labels"], ["enhancement", "P3", "the-daily"])
        self.assertEqual(Fake.wit["gh_created"]["body"], "Line one\nLine two")
        self.assertEqual(it["fields"]["System.WorkItemType"], "Feature")
        code, _, _ = self.req("POST", "/api/workitems/comment?provider=github", {"id": 5, "text": "<p>Looks <strong>good</strong></p>"})
        self.assertEqual(Fake.gh_comments[5][-1], "Looks **good**")
        code, c, _ = self.req("GET", "/api/workitems/5/comments?provider=github")
        self.assertEqual(c["comments"][-1]["createdBy"]["displayName"], "me")
        code, t, _ = self.req("GET", "/api/workitems/types?provider=github")
        self.assertEqual([x["name"] for x in t["value"]], ["Bug", "Task", "Feature", "Issue"])

    def test_provider_routing_for_work_items(self):
        code, j, _ = self.req("GET", "/api/workitems/projects?provider=ado")
        self.assertEqual([p["name"] for p in j["value"]], ["proj1", "proj2"])
        code, j, _ = self.req("GET", "/api/workitems/projects?provider=github")
        self.assertEqual(j["value"], [{"name": "me/journal"}])
        code, j, _ = self.req("GET", "/api/workitems/projects?provider=gitlab")
        self.assertEqual(code, 404)

    # ------------------------------------------------------------- GitHub Projects (v2)
    def test_github_projects(self):
        code, p, _ = self.req("GET", "/api/projects")
        self.assertEqual(code, 200, p)
        self.assertEqual(p["statuses"], ["Todo", "In Progress", "Done"])
        self.assertEqual([(i["kind"], i["number"], i["status"]) for i in p["items"]], [("issue", 5, "In Progress"), ("draft", None, "")])
        self.assertNotIn("_options", p)
        code, st, _ = self.req("GET", "/api/projects/issue?number=5")
        self.assertEqual((st["inProject"], st["status"]), (True, "In Progress"))
        Fake.gh_issues.setdefault(6, _issue(6, "New one"))
        code, r, _ = self.req("POST", "/api/projects/item", {"issue": 6, "status": "Done"})
        self.assertEqual((code, r["itemId"]), (200, "PVTI_new"), r)
        ops = [o[0] for o in Fake.gh_graphql[-2:]]
        self.assertEqual(ops, ["mutation", "mutation"])
        self.assertEqual(Fake.gh_graphql[-1][1]["o"], "o3")
        code, r, _ = self.req("POST", "/api/projects/item", {"itemId": "PVTI_5", "status": "Nope"})
        self.assertEqual(code, 400)
        self.assertIn("Bearer " + PROJ_TOKEN, Fake.auth_seen)   # Projects use their own token

    # ------------------------------------------------------------- pipeline runs
    def test_runs_github_and_ado(self):
        code, r, _ = self.req("GET", "/api/runs?provider=github")
        run = r["value"][0]
        self.assertEqual((code, r["provider"], run["result"], run["commit"]), (200, "GitHub Actions", "failure", "abcdef1"))
        code, x, _ = self.req("POST", "/api/runs/rerun?provider=github", {"id": 9, "result": "failure"})
        self.assertEqual((code, Fake.gh_rerun[-1]), (200, (9, "rerun-failed-jobs")))
        code, r, _ = self.req("GET", "/api/runs?provider=ado")
        run = r["value"][0]
        self.assertEqual((r["provider"], run["result"], run["status"], run["branch"]), ("Azure Pipelines", "partial", "completed", "main"))
        code, x, _ = self.req("POST", "/api/runs/rerun?provider=ado", {"id": 501})
        self.assertEqual((code, Fake.ado_builds[-1]["definition"]["id"]), (200, 4))

    def test_repository_delete(self):
        Fake.gh["main"]["journal/2026/10/11/gone--d1.md"] = b"# gone\n"
        code, j, _ = self.req("POST", "/api/repositories/delete", {"provider": "github", "path": "2026/10/11/gone--d1.md"})
        self.assertEqual((code, j["deleted"]), (200, True), j)
        self.assertNotIn("journal/2026/10/11/gone--d1.md", Fake.gh["main"])
        code, j, _ = self.req("POST", "/api/repositories/delete", {"provider": "github", "path": "2026/10/11/gone--d1.md"})
        self.assertEqual((code, j["deleted"], j["missing"]), (200, False, True))
        code, j, _ = self.req("POST", "/api/repositories/delete", {"provider": "github", "path": "../secrets.md"})
        self.assertEqual(code, 400)
        code, j, _ = self.req("POST", "/api/repositories/delete", {"provider": "github", "path": "2026/x.txt"})
        self.assertEqual(code, 400)
        Fake.ado["main"]["/journal/2026/10/11/gone--d2.md"] = b"# gone\n"
        code, j, _ = self.req("POST", "/api/repositories/delete", {"provider": "ado", "path": "2026/10/11/gone--d2.md"})
        self.assertEqual((code, j["deleted"]), (200, True), j)
        self.assertNotIn("/journal/2026/10/11/gone--d2.md", Fake.ado["main"])
        self.assertEqual(Fake.ado_pushes[-1]["commits"][0]["changes"], [{"changeType": "delete", "item": {"path": "/journal/2026/10/11/gone--d2.md"}}])

    def test_vault_round_trip(self):
        code, v, _ = self.req("GET", "/api/vault")
        self.assertEqual((code, v["enabled"]), (200, True))
        self.assertTrue(v["id"])
        rel = "2026/10/11/note--v1.md"
        code, w, _ = self.req("PUT", "/api/vault/file", {"path": rel, "content": "# one\n", "ifMatch": None})
        self.assertEqual(code, 200, w)
        code, again, _ = self.req("PUT", "/api/vault/file", {"path": rel, "content": "# one\n", "ifMatch": None})
        self.assertEqual(code, 409)            # "must not exist" no longer holds
        self.assertEqual(again["etag"], w["etag"])
        code, w2, _ = self.req("PUT", "/api/vault/file", {"path": rel, "content": "# two\n", "ifMatch": w["etag"]})
        self.assertEqual(code, 200, w2)
        code, stale, _ = self.req("PUT", "/api/vault/file", {"path": rel, "content": "# three\n", "ifMatch": w["etag"]})
        self.assertEqual((code, stale["content"]), (409, "# two\n"))
        code, lst, _ = self.req("GET", "/api/vault/list")
        self.assertIn(rel, [f["path"] for f in lst["files"]])
        code, f, _ = self.req("GET", "/api/vault/file?path=" + urllib.parse.quote(rel))
        self.assertEqual((f["content"], f["etag"]), ("# two\n", w2["etag"]))
        code, d, _ = self.req("POST", "/api/vault/delete", {"path": rel, "ifMatch": w2["etag"]})
        self.assertEqual((code, d["deleted"]), (200, True), d)
        self.assertTrue(d["trash"].startswith(".trash/"))
        code, lst, _ = self.req("GET", "/api/vault/list")
        self.assertNotIn(rel, [f["path"] for f in lst["files"]])          # trash is not listed
        for bad in ("../x.md", "/etc/passwd", ".trash/2026/a.md", "2026/a.txt", "a/../../b.md"):
            code, _, _ = self.req("PUT", "/api/vault/file", {"path": bad, "content": "x"})
            self.assertIn(code, (400, 403), bad)

    def test_path_rules(self):
        for bad in ("../secrets.md", "2026/../../x.md", "a/b.txt", "", "/etc/passwd"):
            code, _, _ = self.req("POST", "/api/repositories/push", {"provider": "github", "path": bad, "markdown": "x"})
            self.assertEqual(code, 400, bad)
        code, _, _ = self.req("GET", "/api/repositories/content?provider=github&path=README.md")
        self.assertEqual(code, 403)

    def test_cross_site_blocked(self):
        code, j, _ = self.req("POST", "/api/repositories/push",
                              {"provider": "github", "path": "2026/01/01/a--b.md", "markdown": "x"},
                              {"Origin": "https://evil.example"})
        self.assertEqual(code, 403)
        code, j, _ = self.req("POST", "/v1/chat/completions", {"messages": [{"role": "user", "content": "x"}]},
                              {"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(code, 403)
        code, j, _ = self.req("GET", "/api/config", headers={"Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(code, 200)

    def test_dns_rebinding_blocked(self):
        code, _, _ = self.req("GET", "/api/config", headers={"Host": f"attacker.example:{self.port}"})
        self.assertEqual(code, 421)

    def test_ai_proxy_overrides_model_and_caps_tokens(self):
        Fake.ai_requests.clear()
        code, j, _ = self.req("POST", "/v1/chat/completions",
                              {"model": "expensive-model", "max_tokens": 99999, "evil": 1,
                               "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(code, 200, j)
        self.assertEqual(j["choices"][0]["message"]["content"], "Hello from fake AI")
        sent = Fake.ai_requests[-1]
        self.assertEqual(sent["model"], "gpt-test")
        self.assertEqual(sent["max_tokens"], 500)
        self.assertNotIn("evil", sent)
        self.assertIn("Bearer " + AI_KEY, Fake.auth_seen)

    def test_ai_retry_max_completion_tokens(self):
        Fake.ai_reject_max_tokens = True
        try:
            code, j, _ = self.req("POST", "/v1/chat/completions",
                                  {"max_tokens": 50, "messages": [{"role": "user", "content": "hi"}]})
            self.assertEqual(code, 200, j)
            self.assertEqual(Fake.ai_requests[-1].get("max_completion_tokens"), 50)
        finally:
            Fake.ai_reject_max_tokens = False

    def test_ai_streaming(self):
        code, body, h = self.req("POST", "/v1/chat/completions",
                                 {"stream": True, "messages": [{"role": "user", "content": "hi"}]}, raw=True)
        self.assertEqual(code, 200)
        self.assertIn("event-stream", h["Content-Type"])
        self.assertIn(b"Hel", body)
        self.assertIn(b"[DONE]", body)

    def test_workitems(self):
        code, j, _ = self.req("GET", "/api/workitems/projects")
        self.assertEqual([p["name"] for p in j["value"]], ["proj1", "proj2"])
        code, j, _ = self.req("POST", "/api/workitems/query",
                              {"states": ["Active"], "search": "it's", "assignedToMe": True, "project": "proj2"})
        self.assertEqual(code, 200, j)
        self.assertEqual([i["id"] for i in j["value"]], [7, 3])  # WIQL order preserved
        self.assertIn("'it''s'", Fake.wit["last_wiql"])  # quotes escaped
        code, j, _ = self.req("POST", "/api/workitems", {"type": "Task", "fields": {"System.Title": "Do it"}})
        self.assertEqual(code, 200, j)
        self.assertEqual(Fake.wit["created"][2], "application/json-patch+json")
        code, _, _ = self.req("POST", "/api/workitems/update", {"id": 7, "fields": {"/bad path": 1}})
        self.assertEqual(code, 400)
        code, _, _ = self.req("POST", "/api/workitems/update", {"id": 7, "fields": {"System.State": "Active"}})
        self.assertEqual(code, 200)
        code, _, _ = self.req("POST", "/api/workitems/comment", {"id": 7, "text": "note"})
        self.assertEqual(Fake.wit["comment"], {"text": "note"})
        code, j, _ = self.req("GET", "/api/workitems/7/comments")
        self.assertEqual(j["comments"][0]["text"], "hi")
        code, _, _ = self.req("GET", "/api/workitems/abc")
        self.assertEqual(code, 404)

    def test_errors_do_not_leak(self):
        code, j, _ = self.req("GET", "/api/repositories/content?provider=github&path=journal/2026/01/01/missing--x.md")
        self.assertEqual(code, 404)
        self.assertNotIn(GH_TOKEN, json.dumps(j))


class DotenvTest(unittest.TestCase):
    def test_parsing(self):
        import importlib.util
        import tempfile
        spec = importlib.util.spec_from_file_location("relay_mod", ROOT / "relay.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as f:
            f.write("ZZ_EMPTY=      # just a comment\nZZ_HASH=abc#def\nZZ_TRAIL=value   # note\n"
                    "ZZ_QUOTED=\"a # b\"\nexport ZZ_EXPORT=yes\nZZ_KEEP=from-file\n")
        old = {k: os.environ.pop(k, None) for k in ("ZZ_EMPTY", "ZZ_HASH", "ZZ_TRAIL", "ZZ_QUOTED", "ZZ_EXPORT")}
        os.environ["ZZ_KEEP"] = "from-env"
        try:
            mod.load_dotenv(Path(f.name))
            self.assertEqual(os.environ["ZZ_EMPTY"], "")
            self.assertEqual(os.environ["ZZ_HASH"], "abc#def")
            self.assertEqual(os.environ["ZZ_TRAIL"], "value")
            self.assertEqual(os.environ["ZZ_QUOTED"], "a # b")
            self.assertEqual(os.environ["ZZ_EXPORT"], "yes")
            self.assertEqual(os.environ["ZZ_KEEP"], "from-env")  # real env wins over .env
        finally:
            for k in ("ZZ_EMPTY", "ZZ_HASH", "ZZ_TRAIL", "ZZ_QUOTED", "ZZ_EXPORT", "ZZ_KEEP"):
                os.environ.pop(k, None)
            os.unlink(f.name)


class RelayStartupTest(unittest.TestCase):
    def _run(self, extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith("DAILY_")}
        env.update({"DAILY_ENV_FILE": "/nonexistent", "DAILY_PORT": str(free_port())}, **extra)
        return subprocess.run([sys.executable, str(ROOT / "relay.py")], env=env, capture_output=True, text=True, timeout=5)

    def test_refuses_public_bind_without_client_key(self):
        r = self._run({"DAILY_HOST": "0.0.0.0"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("DAILY_CLIENT_KEY", r.stderr)


class ClientKeyTest(unittest.TestCase):
    def test_client_key_required(self):
        port = free_port()
        env = {k: v for k, v in os.environ.items() if not k.startswith("DAILY_")}
        env.update({"DAILY_ENV_FILE": "/nonexistent", "DAILY_PORT": str(port), "DAILY_CLIENT_KEY": "k3y-123456"})
        p, logf = start_relay(env, port)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with self.assertRaises(urllib.error.HTTPError) as cm:
                opener.open(f"http://127.0.0.1:{port}/api/config", timeout=2)
            self.assertEqual(cm.exception.code, 401)
            r = urllib.request.Request(f"http://127.0.0.1:{port}/api/config", headers={"X-Daily-Client-Key": "k3y-123456"})
            self.assertEqual(opener.open(r, timeout=2).status, 200)
        finally:
            stop_relay(p, logf)


if __name__ == "__main__":
    unittest.main()
