"""
AI provider tests for relay.py: Azure OpenAI / Foundry (v1 API, keys and Entra ID),
reasoning-model adaptation, Anthropic Claude (native and streaming), the connection
doctor, model listing, and endpoint shapes for the named presets.
No real credentials or network access needed.
"""
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
from test_relay import ROOT, free_port, start_relay, stop_relay  # noqa: E402

AZ_KEY = "azkey_TEST_should_never_leak_5f3a9c"
ANTH_KEY = "sk-ant-TEST_should_never_leak_77e1"
SP_SECRET = "sp-secret_TEST_should_never_leak_19"
ENTRA_TOKEN = "eyJ0eXAi.ENTRA_TOKEN_should_never_leak.sig"


class Seen:
    azure = []      # (headers, body)
    anthropic = []
    token_forms = []


class FakeAI(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        p = urllib.parse.urlsplit(self.path).path
        if p == "/az/openai/v1/models":
            return self._json(200, {"data": [{"id": "gpt-5-mini"}, {"id": "gpt-4.1"}]})
        if p == "/anth/v1/models":
            return self._json(200, {"data": [{"id": "claude-sonnet-5-5"}, {"id": "claude-haiku-5-5"}]})
        return self._json(404, {"error": {"message": "no route"}})

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        p = u.path
        raw = self._body()
        if p == "/login/tenant-1/oauth2/v2.0/token":
            Seen.token_forms.append(urllib.parse.parse_qs(raw.decode()))
            return self._json(200, {"access_token": ENTRA_TOKEN, "expires_in": 3600})
        if p == "/az/openai/v1/chat/completions" or p.startswith("/az/openai/deployments/"):
            b = json.loads(raw or b"{}")
            Seen.azure.append(({k.lower(): v for k, v in self.headers.items()}, b, self.path))
            if self.headers.get("api-key") != AZ_KEY and self.headers.get("Authorization") != "Bearer " + ENTRA_TOKEN:
                return self._json(401, {"error": {"code": "401", "message": "Access denied due to invalid subscription key or wrong API endpoint."}})
            model = b.get("model") or p.split("/deployments/")[-1].split("/")[0]
            if model != "gpt-5-mini":
                return self._json(404, {"error": {"code": "DeploymentNotFound", "message": "The API deployment for this resource does not exist."}})
            if "max_tokens" in b:
                return self._json(400, {"error": {"message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."}})
            if "temperature" in b and b["temperature"] != 1:
                return self._json(400, {"error": {"message": "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported."}})
            if (b.get("max_completion_tokens") or 0) < 200:
                return self._json(200, {"choices": [{"message": {"content": ""}, "finish_reason": "length"}]})
            return self._json(200, {"choices": [{"message": {"content": "connected"}, "finish_reason": "stop"}],
                                    "usage": {"prompt_tokens": 9, "completion_tokens": 190, "total_tokens": 199}})
        if p == "/anth/v1/messages":
            b = json.loads(raw or b"{}")
            Seen.anthropic.append(({k.lower(): v for k, v in self.headers.items()}, b))
            if self.headers.get("x-api-key") != ANTH_KEY or self.headers.get("anthropic-version") != "2023-06-01":
                return self._json(401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
            if b.get("stream"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                events = [("message_start", {"type": "message_start", "message": {"id": "msg_1"}}),
                          ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
                          ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}}),
                          ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": " there"}}),
                          ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}),
                          ("message_stop", {"type": "message_stop"})]
                for name, obj in events:
                    self.wfile.write(f"event: {name}\ndata: {json.dumps(obj)}\n\n".encode())
                    self.wfile.flush()
                return
            return self._json(200, {"id": "msg_1", "type": "message", "content": [{"type": "text", "text": "Hello from Claude"}],
                                    "stop_reason": "end_turn", "usage": {"input_tokens": 5, "output_tokens": 3}})
        return self._json(404, {"error": {"message": "no route " + p}})


def relay_env(port, **kv):
    env = {k: v for k, v in os.environ.items() if not k.startswith("DAILY_")}
    env.update({"DAILY_ENV_FILE": "/nonexistent", "DAILY_PORT": str(port),
                "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"})
    env.update({k: str(v) for k, v in kv.items()})
    return env


class AIProvidersTest(unittest.TestCase):
    relays = {}

    @classmethod
    def setUpClass(cls):
        cls.up = ThreadingHTTPServer(("127.0.0.1", 0), FakeAI)
        threading.Thread(target=cls.up.serve_forever, daemon=True).start()
        u = f"http://127.0.0.1:{cls.up.server_address[1]}"
        configs = {
            # Foundry resource root, no API version → v1 API; gpt-5 family detected as a reasoning model
            "foundry": dict(DAILY_AI_PROVIDER="foundry", DAILY_AI_BASE_URL=u + "/az", DAILY_AI_API_KEY=AZ_KEY,
                            DAILY_AI_MODEL="gpt-5-mini", DAILY_AI_MAX_TOKENS=2000),
            # A custom deployment name hides the model family: the relay must adapt on the fly.
            # Also signs in with a service principal (Entra ID) instead of a key.
            "entra": dict(DAILY_AI_PROVIDER="azure", DAILY_AI_BASE_URL=u + "/az/openai/v1", DAILY_AI_AUTH="entra",
                          DAILY_AI_TENANT_ID="tenant-1", DAILY_AI_CLIENT_ID="app-1", DAILY_AI_CLIENT_SECRET=SP_SECRET,
                          DAILY_AI_AUTHORITY=u + "/login", DAILY_AI_MODEL="gpt-5-mini", DAILY_AI_REASONING="off",
                          DAILY_AI_MAX_TOKENS=2000),
            "claude": dict(DAILY_AI_PROVIDER="anthropic", DAILY_AI_BASE_URL=u + "/anth", DAILY_AI_API_KEY=ANTH_KEY,
                           DAILY_AI_MODEL="claude-sonnet-5-5"),
            "wrong": dict(DAILY_AI_PROVIDER="azure", DAILY_AI_BASE_URL=u + "/az/openai/v1", DAILY_AI_API_KEY=AZ_KEY,
                          DAILY_AI_MODEL="gpt-5-mini-prod"),
        }
        try:
            for name, kv in configs.items():
                port = free_port()
                proc, log = start_relay(relay_env(port, **kv), port)
                cls.relays[name] = (port, proc, log)
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        for name, (port, proc, log) in list(cls.relays.items()):
            out = stop_relay(proc, log)
            for s in (AZ_KEY, ANTH_KEY, SP_SECRET, ENTRA_TOKEN):
                assert s not in out, f"secret leaked into the {name} relay log"
        cls.relays = {}
        cls.up.shutdown()

    def req(self, relay, method, path, body=None, raw=False):
        port = self.relays[relay][0]
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method,
                                   headers={"Content-Type": "application/json"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(r, timeout=20) as resp:
                b = resp.read()
                return resp.status, (b if raw else json.loads(b or b"{}")), resp.headers
        except urllib.error.HTTPError as e:
            b = e.read()
            return e.code, (b if raw else json.loads(b or b"{}")), e.headers

    def no_secrets(self, obj):
        text = json.dumps(obj) if not isinstance(obj, (bytes, str)) else (obj.decode() if isinstance(obj, bytes) else obj)
        for s in (AZ_KEY, ANTH_KEY, SP_SECRET, ENTRA_TOKEN):
            self.assertNotIn(s, text)

    # ------------------------------------------------------------------ Azure / Foundry
    def test_foundry_v1_reasoning_model(self):
        Seen.azure.clear()
        code, j, _ = self.req("foundry", "POST", "/v1/chat/completions",
                              {"model": "anything", "max_tokens": 8, "temperature": 0,
                               "messages": [{"role": "user", "content": "Reply with one word"}]})
        self.assertEqual(code, 200, j)
        self.assertEqual(j["choices"][0]["message"]["content"], "connected")
        headers, body, path = Seen.azure[-1]
        self.assertEqual(path, "/az/openai/v1/chat/completions")     # v1 route, no api-version
        self.assertEqual(headers.get("api-key"), AZ_KEY)
        self.assertEqual(body["model"], "gpt-5-mini")
        self.assertNotIn("max_tokens", body)
        self.assertNotIn("temperature", body)
        self.assertEqual(body["max_completion_tokens"], 1024)         # reasoning floor, under the 2000 cap
        self.assertEqual(len(Seen.azure), 1)                          # no wasted round trips

    def test_entra_and_adaptation_for_custom_deployment(self):
        Seen.azure.clear()
        Seen.token_forms.clear()
        code, j, h = self.req("entra", "POST", "/v1/chat/completions",
                              {"max_tokens": 16, "temperature": 0, "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(code, 200, j)
        self.assertEqual(j["choices"][0]["message"]["content"], "connected")
        self.assertEqual(Seen.azure[-1][0].get("authorization"), "Bearer " + ENTRA_TOKEN)
        self.assertNotIn("api-key", Seen.azure[-1][0])
        form = Seen.token_forms[-1]
        self.assertEqual((form["grant_type"][0], form["client_id"][0], form["scope"][0]),
                         ("client_credentials", "app-1", "https://ai.azure.com/.default"))
        adapted = h.get("X-Daily-AI-Adapted", "")
        for part in ("max_completion_tokens", "dropped temperature", "raised token budget"):
            self.assertIn(part, adapted)
        # the token is cached: a second call doesn't sign in again
        self.req("entra", "POST", "/v1/chat/completions", {"max_tokens": 1500, "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(len(Seen.token_forms), 1)
        code, cfg, _ = self.req("entra", "GET", "/api/config")
        self.assertEqual((cfg["ai"]["auth"], cfg["ai"]["kind"], cfg["ai"]["configured"]), ("entra", "azure", True))
        self.no_secrets(cfg)

    def test_doctor_success(self):
        code, d, _ = self.req("foundry", "POST", "/api/ai/doctor", {})
        self.assertEqual(code, 200, d)
        self.assertTrue(d["ok"], d)
        self.assertEqual([s["label"] for s in d["steps"]][:4], ["Configuration", "Network", "Credentials", "Test request"])
        self.assertTrue(all(s["ok"] for s in d["steps"]))
        self.assertEqual(d["reply"], "connected")
        self.assertTrue(d["ai"]["reasoning"])
        self.no_secrets(d)

    def test_doctor_explains_wrong_deployment(self):
        code, d, _ = self.req("wrong", "POST", "/api/ai/doctor", {})
        self.assertEqual(code, 200)
        self.assertFalse(d["ok"])
        last = d["steps"][-1]
        self.assertEqual(last["label"], "Test request")
        self.assertIn("404", last["fix"])
        self.assertIn("deployment name", last["fix"])
        code, j, _ = self.req("wrong", "POST", "/v1/chat/completions", {"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(code, 404)
        self.assertIn("gpt-5-mini-prod", j["error"]["message"])
        self.no_secrets(d)

    def test_models_listing(self):
        code, m, _ = self.req("foundry", "GET", "/api/ai/models")
        self.assertEqual(m["models"], ["gpt-4.1", "gpt-5-mini"])
        self.assertIn("deployment name", m["note"])
        code, m, _ = self.req("claude", "GET", "/api/ai/models")
        self.assertEqual(m["models"], ["claude-haiku-5-5", "claude-sonnet-5-5"])

    # ------------------------------------------------------------------ Anthropic
    def test_anthropic_translation(self):
        Seen.anthropic.clear()
        code, j, _ = self.req("claude", "POST", "/v1/chat/completions",
                              {"temperature": 1.4, "max_tokens": 300,
                               "messages": [{"role": "system", "content": "Be brief."},
                                            {"role": "user", "content": "Hello"},
                                            {"role": "user", "content": [{"type": "text", "text": "again"}]}]})
        self.assertEqual(code, 200, j)
        self.assertEqual(j["choices"][0]["message"]["content"], "Hello from Claude")
        self.assertEqual(j["usage"]["total_tokens"], 8)
        headers, body = Seen.anthropic[-1]
        self.assertEqual(body["system"], "Be brief.")
        self.assertEqual(body["messages"], [{"role": "user", "content": "Hello\n\nagain"}])
        self.assertEqual((body["model"], body["max_tokens"], body["temperature"]), ("claude-sonnet-5-5", 300, 1.0))
        self.assertNotIn("authorization", headers)

    def test_anthropic_streaming_is_translated(self):
        code, raw, h = self.req("claude", "POST", "/v1/chat/completions",
                                {"stream": True, "messages": [{"role": "user", "content": "hi"}]}, raw=True)
        self.assertEqual(code, 200)
        self.assertIn("event-stream", h["Content-Type"])
        chunks = [json.loads(l[6:]) for l in raw.decode().split("\n") if l.startswith("data: {")]
        text = "".join((c["choices"][0]["delta"].get("content") or "") for c in chunks if c.get("choices"))
        self.assertEqual(text, "Hi there")
        self.assertTrue(raw.rstrip().endswith(b"data: [DONE]"))


class EndpointShapeTest(unittest.TestCase):
    """ai_endpoint() for the base-URL shapes people paste from portals."""

    def shape(self, **kv):
        import importlib
        old = dict(os.environ)
        try:
            for k in [k for k in os.environ if k.startswith("DAILY_")]:
                del os.environ[k]
            os.environ.update({k: str(v) for k, v in kv.items()})
            sys.path.insert(0, str(ROOT))
            relay = importlib.import_module("relay")
            relay.S = relay.Settings()
            return relay.ai_endpoint(), relay.S
        finally:
            os.environ.clear()
            os.environ.update(old)

    def test_shapes(self):
        cases = [
            (dict(DAILY_AI_PROVIDER="azure", DAILY_AI_BASE_URL="https://r.openai.azure.com", DAILY_AI_MODEL="d"),
             ("https://r.openai.azure.com/openai/v1/chat/completions", True)),
            (dict(DAILY_AI_PROVIDER="azure", DAILY_AI_BASE_URL="https://r.openai.azure.com/openai/v1/", DAILY_AI_MODEL="d"),
             ("https://r.openai.azure.com/openai/v1/chat/completions", True)),
            (dict(DAILY_AI_PROVIDER="azure", DAILY_AI_BASE_URL="https://r.openai.azure.com", DAILY_AI_MODEL="d",
                  DAILY_AI_API_VERSION="2024-10-21"),
             ("https://r.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21", False)),
            (dict(DAILY_AI_PROVIDER="compatible", DAILY_AI_BASE_URL="https://r.services.ai.azure.com/openai/v1", DAILY_AI_MODEL="d"),
             ("https://r.services.ai.azure.com/openai/v1/chat/completions", True)),
            (dict(DAILY_AI_PROVIDER="foundry", DAILY_AI_BASE_URL="https://r.services.ai.azure.com/anthropic", DAILY_AI_MODEL="claude-opus-5-5"),
             ("https://r.services.ai.azure.com/anthropic/v1/messages", True)),
            (dict(DAILY_AI_PROVIDER="gemini", DAILY_AI_MODEL="gemini-x"),
             ("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", True)),
            (dict(DAILY_AI_PROVIDER="ollama", DAILY_AI_MODEL="llama3.1"),
             ("http://localhost:11434/v1/chat/completions", True)),
            (dict(DAILY_AI_PROVIDER="compatible", DAILY_AI_BASE_URL="http://localhost:1234", DAILY_AI_MODEL="m"),
             ("http://localhost:1234/v1/chat/completions", True)),
        ]
        for kv, want in cases:
            with self.subTest(kv=kv):
                got, _ = self.shape(**kv)
                self.assertEqual(got, want)

    def test_kind_and_requirements(self):
        _, s = self.shape(DAILY_AI_PROVIDER="foundry", DAILY_AI_BASE_URL="https://r.services.ai.azure.com/anthropic",
                          DAILY_AI_MODEL="claude-opus-5-5", DAILY_AI_API_KEY="k")
        self.assertEqual((s.ai_kind, s.ai_label, s.ai_enabled), ("anthropic", "Claude in Microsoft Foundry", True))
        _, s = self.shape(DAILY_AI_PROVIDER="azure", DAILY_AI_BASE_URL="https://r.openai.azure.com", DAILY_AI_MODEL="d")
        self.assertEqual(s.ai_missing, ["DAILY_AI_API_KEY"])
        _, s = self.shape(DAILY_AI_PROVIDER="azure", DAILY_AI_BASE_URL="https://r.openai.azure.com", DAILY_AI_MODEL="d",
                          DAILY_AI_AUTH="entra")
        self.assertEqual((s.ai_missing, s.ai_enabled), ([], True))
        _, s = self.shape(DAILY_AI_PROVIDER="ollama", DAILY_AI_MODEL="llama3.1")
        self.assertTrue(s.ai_enabled)


if __name__ == "__main__":
    unittest.main()
