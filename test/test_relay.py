"""
End-to-end tests for relay.py against a fake GitHub / Azure DevOps / OpenAI server.
No real credentials or network access needed.

    python -m unittest discover -s test -p "test_*.py" -v
"""
import base64
import json
import os
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


class Fake:
    """In-memory upstream state shared with the handler."""
    gh_files = {}       # path -> text
    ado_files = {}      # path (leading /) -> text
    ai_requests = []
    auth_seen = []
    wit = {}
    ai_reject_max_tokens = False


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
        p = self.path
        # ---------- GitHub
        if p.startswith("/gh/repos/me/journal/contents/"):
            path = urllib.parse.unquote(p.split("/contents/", 1)[1].split("?", 1)[0])
            if self.command == "GET":
                if path in Fake.gh_files:
                    return self._json(200, {"sha": "sha-" + path, "encoding": "base64",
                                            "content": base64.b64encode(Fake.gh_files[path].encode()).decode()})
                return self._json(404, {"message": "Not Found"})
            if self.command == "PUT":
                b = self._body()
                Fake.gh_files[path] = base64.b64decode(b["content"]).decode()
                return self._json(201, {"content": {"sha": "new"}, "commit": {"html_url": "https://github.example/c/1"}})
        if p.startswith("/gh/repos/me/journal/git/ref/heads/main"):
            return self._json(200, {"object": {"sha": "tree1"}})
        if p.startswith("/gh/repos/me/journal/git/trees/tree1"):
            return self._json(200, {"tree": [{"type": "blob", "path": k, "sha": "s"} for k in Fake.gh_files]
                                    + [{"type": "blob", "path": "README.md", "sha": "x"}]})
        # ---------- Azure DevOps repos
        base = "/ado/org1/proj1/_apis/git/repositories/repo1"
        if p.startswith(base + "/refs"):
            return self._json(200, {"value": [{"name": "refs/heads/main", "objectId": "abc"}]})
        if p.startswith(base + "/pushes"):
            b = self._body()
            ch = b["commits"][0]["changes"][0]
            Fake.ado_files[ch["item"]["path"]] = ch["newContent"]["content"]
            return self._json(201, {"pushId": 1})
        if p.startswith(base + "/items"):
            qs = urllib.parse.parse_qs(urllib.parse.urlsplit(p).query)
            if "scopePath" in qs:
                return self._json(200, {"value": [{"path": k, "isFolder": False, "objectId": "o"} for k in Fake.ado_files]})
            path = qs["path"][0]
            if path in Fake.ado_files:
                return self._json(200, Fake.ado_files[path], "text/plain")
            return self._json(404, {"message": "not found"})
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
            Fake.wit["created"] = (p, ops, self.headers.get("Content-Type"))
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
        return self._json(404, {"message": "fake: no route " + p})

    do_GET = do_POST = do_PUT = do_PATCH = handle_any


import urllib.parse  # noqa: E402  (used by the fake handler)


class RelayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
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
        for s in (GH_TOKEN, ADO_PAT, AI_KEY):
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
        self.assertEqual(Fake.gh_files["journal/2026/10/04/hello--abc.md"], "# Hi")
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
        self.assertEqual(Fake.ado_files["/journal/2026/10/04/x--1.md"], "# ADO")
        code, files, _ = self.req("GET", "/api/repositories/files?provider=ado")
        self.assertEqual(files["value"][0]["path"], "/journal/2026/10/04/x--1.md")
        code, text, _ = self.req("GET", "/api/repositories/content?provider=ado&path=/journal/2026/10/04/x--1.md", raw=True)
        self.assertEqual(text.decode(), "# ADO")

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
