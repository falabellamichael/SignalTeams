"""Zero-dependency smoke test — boots uvicorn on a free port against a temp DB.

Run: python -m unittest tests.test_smoke   (from backend/)
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(BASE, ".venv", "Scripts", "python.exe")
if not os.path.exists(PY):
    PY = sys.executable


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _req(port, method, path, body=None, token=None, expect=200):
    r = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(r, timeout=10) as res:
            assert res.status == expect, f"{method} {path} -> {res.status}"
            return json.loads(res.read() or b"null")
    except urllib.error.HTTPError as e:
        assert e.code == expect, f"{method} {path} -> {e.code} (want {expect}): {e.read()[:200]}"
        return json.loads(e.read() or b"null")


class Smoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = _free_port()
        cls.tmp = tempfile.mkdtemp(prefix="st-test-")
        env = {**os.environ,
               "AGENTHIVE_DB": os.path.join(cls.tmp, "test.db"),
               "AGENTHIVE_MODELDIR": cls.tmp}   # empty dir -> modeldir scan is a no-op
        cls.proc = subprocess.Popen(
            [PY, "-m", "uvicorn", "app.main:app",
             "--host", "127.0.0.1", "--port", str(cls.port)],
            cwd=BASE, env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(120):
            try:
                urllib.request.urlopen(
                    f"http://127.0.0.1:{cls.port}/api/health", timeout=1)
                return
            except Exception:
                time.sleep(0.25)
        cls.proc.kill()
        raise RuntimeError("server did not come up")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()

    def req(self, *a, **kw):
        return _req(self.port, *a, **kw)

    def test_health(self):
        d = self.req("GET", "/api/health")
        self.assertTrue(d["ok"])

    def test_auth_flow_and_message_roundtrip(self):
        reg = self.req("POST", "/api/register",
                       {"username": "tester", "password": "pw12345"})
        tok = reg["token"]
        self.assertTrue(tok)
        me = self.req("GET", "/api/me", token=tok)
        self.assertEqual(me["username"], "tester")

        # no token -> 401 (or 403 depending on dependency wiring)
        self.req("GET", "/api/servers", expect=401)

        srv = self.req("POST", "/api/servers",
                       {"name": "Test HQ", "icon": "🧪"}, token=tok)
        self.assertEqual(srv["name"], "Test HQ")
        self.assertTrue(srv["invite_code"])
        detail = self.req("GET", f"/api/servers/{srv['id']}", token=tok)
        chan = next(c for c in detail["channels"] if c["kind"] == "text")

        sent = self.req("POST", f"/api/channels/{chan['id']}/messages",
                        {"content": "hello world"}, token=tok)
        self.assertEqual(sent["content"], "hello world")

        msgs = self.req("GET", f"/api/channels/{chan['id']}/messages", token=tok)
        self.assertEqual(msgs[-1]["content"], "hello world")

        # second user joins via invite, friendship-free buzz safety, dms
        reg2 = self.req("POST", "/api/register",
                        {"username": "tester2", "password": "pw12345"})
        joined = self.req("POST", "/api/servers/join",
                          {"invite_code": srv["invite_code"]}, token=reg2["token"])
        self.assertEqual(joined["id"], srv["id"])

        dm = self.req("POST", f"/api/dms/{reg2['user']['id']}", token=tok)
        self.assertTrue(dm["id"])

        # @silent message modifier test
        buzz_before = self.req("GET", "/api/buzz", token=reg2["token"])
        silent_msg = self.req("POST", f"/api/channels/{chan['id']}/messages",
                              {"content": "@silent @tester2 quiet message"}, token=tok)
        self.assertEqual(silent_msg["content"], "@tester2 quiet message")
        buzz_after_silent = self.req("GET", "/api/buzz", token=reg2["token"])
        self.assertEqual(len(buzz_before), len(buzz_after_silent))

        # loud mention emits buzz
        loud_msg = self.req("POST", f"/api/channels/{chan['id']}/messages",
                            {"content": "@tester2 loud message"}, token=tok)
        self.assertEqual(loud_msg["content"], "@tester2 loud message")
        buzz_after_loud = self.req("GET", "/api/buzz", token=reg2["token"])
        self.assertEqual(len(buzz_after_loud), len(buzz_before) + 1)

        # Message AI ops validation
        self.req("POST", f"/api/messages/{silent_msg['id']}/ai",
                 {"op": "bad_op"}, token=tok, expect=400)
        self.req("POST", f"/api/messages/999999/ai",
                 {"op": "summarize"}, token=tok, expect=404)
        # Calling without LLM running in temp test env returns 502 gracefully
        ai_res = self.req("POST", f"/api/messages/{silent_msg['id']}/ai",
                          {"op": "summarize"}, token=tok, expect=502)
        self.assertIn("AI op failed", ai_res["detail"])

    def test_llm_providers_shape(self):
        reg = self.req("POST", "/api/register",
                       {"username": "llmtester", "password": "pw12345"})
        provs = self.req("GET", "/api/llm/providers", token=reg["token"])
        self.assertIsInstance(provs, list)
        for p in provs:
            self.assertIn("name", p)
            self.assertIn("models", p)


    def test_discord_features(self):
        reg = self.req("POST", "/api/register",
                       {"username": "discord_tester", "password": "pw12345"})
        tok = reg["token"]
        uid = reg["user"]["id"]

        # Profile banner_color & pronouns customization
        patched = self.req("PATCH", "/api/me",
                           {"banner_color": "#5865F2", "pronouns": "they/them"},
                           token=tok)
        self.assertEqual(patched["banner_color"], "#5865F2")
        self.assertEqual(patched["pronouns"], "they/them")

        prof = self.req("GET", f"/api/users/{uid}/profile", token=tok)
        self.assertEqual(prof["user"]["banner_color"], "#5865F2")
        self.assertEqual(prof["user"]["pronouns"], "they/them")

        # Create server & channel for embeds
        srv = self.req("POST", "/api/servers",
                       {"name": "Embed HQ", "icon": "⚡"}, token=tok)
        detail = self.req("GET", f"/api/servers/{srv['id']}", token=tok)
        chan = next(c for c in detail["channels"] if c["kind"] == "text")

        # Post message with rich embed
        embed_payload = {
            "title": "Welcome to SignalTeams",
            "description": "Discord-style rich embed card",
            "color": "#5865F2",
            "fields": [
                {"name": "Status", "value": "Operational", "inline": True},
                {"name": "Latency", "value": "12ms", "inline": True}
            ]
        }
        msg = self.req("POST", f"/api/channels/{chan['id']}/messages",
                       {"content": "Check this embed!", "embed": embed_payload},
                       token=tok)
        self.assertIsNotNone(msg.get("embed"))
        self.assertEqual(msg["embed"]["title"], "Welcome to SignalTeams")
        self.assertEqual(len(msg["embed"]["fields"]), 2)

        # Webhook incoming Discord embed translation
        wh = self.req("POST", f"/api/channels/{chan['id']}/webhooks",
                      {"name": "embed-bot"}, token=tok)
        self.assertTrue(wh.get("token"))

        wh_payload = {
            "content": "Alert from bot",
            "embeds": [{
                "title": "GitHub Release v2.0",
                "description": "Discord webhook embed test",
                "color": 5793266,
                "fields": [{"name": "Author", "value": "agent", "inline": True}]
            }]
        }
        wh_res = self.req("POST", f"/api/hooks/{wh['token']}", wh_payload)
        self.assertTrue(wh_res.get("ok"))

        msgs = self.req("GET", f"/api/channels/{chan['id']}/messages", token=tok)
        last_msg = msgs[-1]
        self.assertEqual(last_msg["content"], "Alert from bot")
        self.assertIsNotNone(last_msg.get("embed"))
        self.assertEqual(last_msg["embed"]["title"], "GitHub Release v2.0")
        self.assertEqual(last_msg["embed"]["color"].lower(), "#5865f2")


if __name__ == "__main__":
    unittest.main()
