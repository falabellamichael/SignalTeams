"""Workspace API tests — sandbox, permissions, revisions, agent tool calls.

Run: python -m unittest tests.test_workspaces   (from backend/)
"""
import json
import os
import tempfile
import unittest

from tests.test_smoke import _free_port, _req, BASE, PY
import subprocess
import time
import urllib.request


class Workspaces(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = _free_port()
        cls.tmp = tempfile.mkdtemp(prefix="st-ws-")
        cls.root = os.path.join(cls.tmp, "proj")
        os.makedirs(os.path.join(cls.root, "src"))
        with open(os.path.join(cls.root, "README.md"), "w", encoding="utf-8") as f:
            f.write("# hello\n\nfirst line\n")
        with open(os.path.join(cls.root, "src", "app.py"), "w", encoding="utf-8") as f:
            f.write("print('hi')\n")
        with open(os.path.join(cls.root, ".env"), "w", encoding="utf-8") as f:
            f.write("SECRET=1\n")
        env = {**os.environ,
               "AGENTHIVE_DB": os.path.join(cls.tmp, "test.db"),
               "AGENTHIVE_MODELDIR": cls.tmp,
               "AGENTHIVE_WORKSPACE_ROOTS": cls.tmp}
        cls.proc = subprocess.Popen(
            [PY, "-m", "uvicorn", "app.main:app",
             "--host", "127.0.0.1", "--port", str(cls.port)],
            cwd=BASE, env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/api/health", timeout=1)
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

    def test_workspace_flow(self):
        owner = self.req("POST", "/api/register",
                         {"username": "wsowner", "password": "pw12345"})
        tok = owner["token"]
        srv = self.req("POST", "/api/servers", {"name": "WS HQ", "icon": "🧪"}, token=tok)

        # roots endpoint reflects the allow-list
        roots = self.req("GET", "/api/workspace-roots", token=tok)
        self.assertIn(self.tmp, roots["roots"])

        # a folder outside the allow-list is refused
        self.req("POST", f"/api/servers/{srv['id']}/workspaces",
                 {"name": "bad", "root": "C:\\Windows"}, token=tok, expect=403)

        ws = self.req("POST", f"/api/servers/{srv['id']}/workspaces",
                      {"name": "proj", "icon": "🗂", "root": self.root}, token=tok)
        self.assertEqual(ws["level"], "admin")
        wid = ws["id"]

        # tree hides dotfiles and lists nested files
        t = self.req("GET", f"/api/workspaces/{wid}/tree", token=tok)
        paths = {e["path"] for e in t["entries"]}
        self.assertIn("README.md", paths)
        self.assertIn("src/app.py", paths)
        self.assertNotIn(".env", paths)

        # read + write + revision history
        f = self.req("GET", f"/api/workspaces/{wid}/file?path=README.md", token=tok)
        self.assertIn("first line", f["content"])
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "README.md", "content": "# hello\n\nsecond line\n"}, token=tok)
        hist = self.req("GET", f"/api/workspaces/{wid}/history?path=README.md", token=tok)
        self.assertEqual(len(hist), 1)
        d = self.req("GET", f"/api/workspaces/{wid}/diff?path=README.md", token=tok)
        self.assertIn("+second line", d["diff"])
        self.assertIn("-first line", d["diff"])

        # path traversal is rejected
        self.req("GET", f"/api/workspaces/{wid}/file?path=../../etc/passwd",
                 token=tok, expect=400)
        # hidden files are refused
        self.req("GET", f"/api/workspaces/{wid}/file?path=.env", token=tok, expect=403)

        # search finds content
        hits = self.req("GET", f"/api/workspaces/{wid}/search?q=print", token=tok)
        self.assertTrue(any(h["path"] == "src/app.py" for h in hits))

        # a second member has no access until granted
        other = self.req("POST", "/api/register",
                         {"username": "wsguest", "password": "pw12345"})
        otok = other["token"]
        self.req("POST", "/api/servers/join", {"invite_code": srv["invite_code"]}, token=otok)
        self.assertEqual(self.req("GET", f"/api/servers/{srv['id']}/workspaces", token=otok), [])
        self.req("GET", f"/api/workspaces/{wid}/tree", token=otok, expect=403)

        # grant read → can list, cannot write
        self.req("POST", f"/api/workspaces/{wid}/grants",
                 {"user_id": other["user"]["id"], "level": "read"}, token=tok)
        self.req("GET", f"/api/workspaces/{wid}/tree", token=otok)
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "README.md", "content": "nope"}, token=otok, expect=403)

        # grant write → can write, still cannot exec
        self.req("POST", f"/api/workspaces/{wid}/grants",
                 {"user_id": other["user"]["id"], "level": "write"}, token=tok)
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "notes.txt", "content": "guest was here"}, token=otok)
        self.req("POST", f"/api/workspaces/{wid}/exec", {"cmd": "echo hi"},
                 token=otok, expect=403)

        # owner can exec
        r = self.req("POST", f"/api/workspaces/{wid}/exec", {"cmd": "echo hi"}, token=tok)
        self.assertEqual(r["code"], 0)
        self.assertIn("hi", r["stdout"])

        # audit log records the guest's write
        acts = self.req("GET", f"/api/workspaces/{wid}/audit", token=tok)
        self.assertTrue(any(a["action"] == "create" and a["path"] == "notes.txt"
                            for a in acts))

        # revoke → access gone
        self.req("POST", f"/api/workspaces/{wid}/grants",
                 {"user_id": other["user"]["id"], "level": ""}, token=tok)
        self.req("GET", f"/api/workspaces/{wid}/tree", token=otok, expect=403)

        # channel wiring shows up in the channel payload
        detail = self.req("GET", f"/api/servers/{srv['id']}", token=tok)
        chan = next(c for c in detail["channels"] if c["kind"] == "text")
        self.req("PATCH", f"/api/channels/{chan['id']}", {"workspace_id": wid}, token=tok)
        detail = self.req("GET", f"/api/servers/{srv['id']}", token=tok)
        chan = next(c for c in detail["channels"] if c["id"] == chan["id"])
        self.assertEqual(chan["workspace"]["id"], wid)

        # unlinking leaves the folder alone
        self.req("DELETE", f"/api/workspaces/{wid}", token=tok)
        self.assertTrue(os.path.isdir(self.root))
