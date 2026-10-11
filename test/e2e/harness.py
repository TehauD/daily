"""
End-to-end harness: a fake GitHub (from test_relay.py), the real relay.py pointed at it
with a temporary journal folder, and a small control server the Playwright specs use to
inspect and change the "remote" and the folder.

    python test/e2e/harness.py            # relay on :8765, control on :8766
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import test_relay as T  # noqa: E402

RELAY_PORT = int(os.environ.get("E2E_RELAY_PORT", "8765"))
CONTROL_PORT = int(os.environ.get("E2E_CONTROL_PORT", "8766"))

import socket  # noqa: E402
for _port in (RELAY_PORT, CONTROL_PORT):
    with socket.socket() as _s:
        if _s.connect_ex(("127.0.0.1", _port)) == 0:
            sys.exit(f"Port {_port} is already in use (a relay or harness left running?). Stop it and retry.")

up = ThreadingHTTPServer(("127.0.0.1", 0), T.FakeUpstream)
threading.Thread(target=up.serve_forever, daemon=True).start()
UP = f"http://127.0.0.1:{up.server_address[1]}"
VAULT = Path(tempfile.mkdtemp(prefix="daily-e2e-vault-"))

env = {k: v for k, v in os.environ.items() if not k.startswith("DAILY_")}
env.update({
    "DAILY_ENV_FILE": "/nonexistent", "DAILY_PORT": str(RELAY_PORT), "DAILY_VAULT_DIR": str(VAULT),
    "DAILY_GITHUB_TOKEN": T.GH_TOKEN, "DAILY_GITHUB_OWNER": "me", "DAILY_GITHUB_REPOSITORY": "journal",
    "DAILY_GITHUB_ROOT": "journal", "DAILY_GITHUB_API_URL": UP + "/gh", "DAILY_PROVIDER": "github",
    "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost",
})
relay = subprocess.Popen([sys.executable, str(HERE.parent.parent / "relay.py")], env=env)

# Wait for the relay before announcing readiness (Playwright polls /health on the control port).
import time  # noqa: E402
import urllib.request  # noqa: E402
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(100):
    try:
        _opener.open(f"http://127.0.0.1:{RELAY_PORT}/healthz", timeout=1)
        break
    except Exception:  # noqa: BLE001
        if relay.poll() is not None:
            sys.exit("relay.py exited during start-up")
        time.sleep(0.2)


class Control(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        gh = T.Fake.gh.setdefault("main", {})
        if u.path == "/health":
            return self._send({"ok": True})
        if u.path == "/reset":
            T.Fake.gh = {"main": {}}
            T.Fake.gh_refs = {"main": "c0"}
            for child in VAULT.iterdir():
                shutil.rmtree(child) if child.is_dir() else child.unlink()
            return self._send({"ok": True})
        if u.path == "/remote":
            if q.get("op") == "replace":
                gh[q["path"]] = gh[q["path"]].decode().replace(q["a"], q["b"]).encode()
            elif q.get("op") == "delete":
                gh.pop(q["path"], None)
            return self._send({"files": {k: v.decode("utf-8", "replace") for k, v in gh.items()}})
        if u.path == "/vault":
            files = {p.relative_to(VAULT).as_posix(): p.read_text("utf-8") for p in VAULT.rglob("*.md")
                     if ".trash" not in p.parts}
            if q.get("op") == "replace":
                f = VAULT / q["path"]
                f.write_text(f.read_text("utf-8").replace(q["a"], q["b"]), "utf-8")
            elif q.get("op") == "delete":
                (VAULT / q["path"]).unlink()
            elif q.get("op") == "write":
                f = VAULT / q["path"]
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(q["content"], "utf-8")
            else:
                return self._send({"files": files, "dir": str(VAULT)})
            return self._send({"ok": True})
        return self._send({"error": "no route"}, 404)


try:
    ThreadingHTTPServer(("127.0.0.1", CONTROL_PORT), Control).serve_forever()
finally:
    relay.terminate()
    shutil.rmtree(VAULT, ignore_errors=True)
