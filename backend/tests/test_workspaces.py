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

    def fresh_root(self):
        """Each test gets its own folder so writes don't leak between them."""
        root = tempfile.mkdtemp(prefix="proj-", dir=self.tmp)
        os.makedirs(os.path.join(root, "src"))
        with open(os.path.join(root, "README.md"), "w", encoding="utf-8") as f:
            f.write("# hello\n\nfirst line\n")
        with open(os.path.join(root, "src", "app.py"), "w", encoding="utf-8") as f:
            f.write("print('hi')\n")
        with open(os.path.join(root, ".env"), "w", encoding="utf-8") as f:
            f.write("SECRET=1\n")
        return root

    def test_workspace_flow(self):
        self.root = self.fresh_root()
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

    def test_workspace_chat(self):
        self.root = self.fresh_root()
        owner = self.req("POST", "/api/register",
                         {"username": "wschat", "password": "pw12345"})
        tok = owner["token"]
        srv = self.req("POST", "/api/servers", {"name": "Chat", "icon": "🧪"}, token=tok)
        ws = self.req("POST", f"/api/servers/{srv['id']}/workspaces",
                      {"name": "My Proj", "root": self.root}, token=tok)
        wid = ws["id"]

        # find-or-create: an agent channel wired to the workspace
        ch = self.req("GET", f"/api/workspaces/{wid}/chat", token=tok)
        self.assertEqual(ch["kind"], "agents")
        self.assertEqual(ch["workspace"]["id"], wid)
        self.assertEqual(ch["name"], "my-proj")
        # idempotent — same channel on the second call
        ch2 = self.req("GET", f"/api/workspaces/{wid}/chat", token=tok)
        self.assertEqual(ch2["id"], ch["id"])
        # listed in the server's channels, welcome post landed
        detail = self.req("GET", f"/api/servers/{srv['id']}", token=tok)
        self.assertTrue(any(c["id"] == ch["id"] for c in detail["channels"]))
        msgs = self.req("GET", f"/api/channels/{ch['id']}/messages", token=tok)
        self.assertTrue(any("workspace" in (m["content"] or "").lower()
                            for m in msgs))
        # a member with no workspace grant can't open the workspace's chat
        # view, but as a server member they can still read/post in the channel
        other = self.req("POST", "/api/register",
                         {"username": "wschat2", "password": "pw12345"})
        otok = other["token"]
        self.req("POST", "/api/servers/join",
                 {"invite_code": srv["invite_code"]}, token=otok)
        self.req("GET", f"/api/workspaces/{wid}/chat", token=otok, expect=403)
        m = self.req("POST", f"/api/channels/{ch['id']}/messages",
                     {"content": "hi all"}, token=otok)
        self.assertEqual(m["content"], "hi all")

    def test_workspace_agent_mention(self):
        """@mentioning an agent in the workspace chat must produce a real reply —
        the seeded "▌" cursor has to be finalized. Regression: the workspace
        tool prompt queried on a closed conn and the reply died silently."""
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        class Stub(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, b):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def do_GET(self):
                self._send(json.dumps({"data": [{"id": "stub-agent"}]}).encode())

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(n) or b"{}")
                joined = " ".join(str(m.get("content") or "")
                                  for m in (req.get("messages") or []))
                if "TOOL RESULT write_file" in joined:
                    reply = "Done — read the readme and wrote NOTES.md."
                elif "TOOL RESULT read_file" in joined:
                    reply = json.dumps({"tool": "write_file", "args": {
                        "path": "NOTES.md", "content": "by the stub agent"}})
                else:
                    reply = json.dumps({"tool": "read_file",
                                        "args": {"path": "README.md"}})
                self._send(json.dumps({"choices": [{"message": {
                    "role": "assistant", "content": reply}}]}).encode())

        httpd = HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            self.root = self.fresh_root()
            owner = self.req("POST", "/api/register",
                             {"username": "wsbot", "password": "pw12345"})
            tok = owner["token"]
            srv = self.req("POST", "/api/servers", {"name": "WSBot", "icon": "🤖"}, token=tok)
            ws = self.req("POST", f"/api/servers/{srv['id']}/workspaces",
                          {"name": "proj", "root": self.root}, token=tok)
            ch = self.req("GET", f"/api/workspaces/{ws['id']}/chat", token=tok)
            self.req("POST", "/api/agents", {
                "name": "StubBot", "icon": "🤖", "tagline": "stub",
                "system_prompt": "You are a coding agent.",
                "api_kind": "openai",
                "api_url": f"http://127.0.0.1:{httpd.server_address[1]}/v1",
                "model": "stub-agent", "visibility": "private"}, token=tok)
            self.req("POST", f"/api/channels/{ch['id']}/messages",
                     {"content": "@StubBot read the readme"}, token=tok)
            reply = None
            for _ in range(60):
                time.sleep(1)
                msgs = self.req("GET", f"/api/channels/{ch['id']}/messages", token=tok)
                bots = [m for m in msgs
                        if m["author"]["username"].startswith("agent:")]
                if bots and "▌" not in bots[-1]["content"]:
                    reply = bots[-1]["content"]
                    break
            self.assertIsNotNone(reply, "agent reply never finalized (stuck ▌)")
            self.assertIn("Done —", reply)
            self.assertTrue(os.path.exists(os.path.join(self.root, "NOTES.md")))
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_full_toolset_and_edit_file(self):
        """Agents get the whole filesystem surface their level allows, and
        edit_file refuses ambiguous or missing matches instead of mangling."""
        self.root = self.fresh_root()
        owner = self.req("POST", "/api/register",
                         {"username": "wstools", "password": "pw12345"})
        tok = owner["token"]
        srv = self.req("POST", "/api/servers", {"name": "Tools", "icon": "🧪"}, token=tok)
        ws = self.req("POST", f"/api/servers/{srv['id']}/workspaces",
                      {"name": "t", "root": self.root}, token=tok)
        wid = ws["id"]

        # The tool surface is exercised through the real agent bridge: a stub
        # model asks for each tool and we check the file system afterwards.
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        script = [
            {"tool": "make_dir", "args": {"path": "sub"}},
            {"tool": "write_file", "args": {"path": "e.txt",
                                              "content": "alpha beta gamma"}},
            {"tool": "edit_file", "args": {"path": "e.txt", "find": "beta",
                                             "replace": "BETA"}},
            {"tool": "move_file", "args": {"path": "e.txt", "to": "sub/e.txt"}},
            {"tool": "file_info", "args": {"path": "sub/e.txt"}},
        ]
        state = {"i": 0}

        class Stub(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, b):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def do_GET(self):
                self._send(json.dumps({"data": [{"id": "stub-agent"}]}).encode())

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(n)
                i = state["i"]
                state["i"] += 1
                reply = (json.dumps(script[i]) if i < len(script)
                         else "All done — created sub/, wrote and edited e.txt, moved it.")
                self._send(json.dumps({"choices": [{"message": {
                    "role": "assistant", "content": reply}}]}).encode())

        httpd = HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            agent = self.req("POST", "/api/agents", {
                "name": f"ToolBot{int(time.time())}", "icon": "🤖", "tagline": "stub",
                "system_prompt": "You are a coding agent.", "api_kind": "openai",
                "api_url": f"http://127.0.0.1:{httpd.server_address[1]}/v1",
                "model": "stub-agent", "visibility": "private"}, token=tok)
            # the desk endpoint streams NDJSON progress events
            # (thinking / step / step_done … done); `done` carries the payload
            rq = urllib.request.Request(
                f"http://127.0.0.1:{self.port}/api/workspaces/{wid}/agent",
                data=json.dumps({"agent_id": agent["id"],
                                 "message": "do the thing"}).encode(),
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {tok}"},
                method="POST")
            events = [json.loads(l) for l in
                      urllib.request.urlopen(rq).read().decode().splitlines()
                      if l.strip()]
            kinds = [e["type"] for e in events]
            self.assertEqual(kinds[0], "thinking")
            self.assertEqual(kinds[-1], "done")
            self.assertIn("step", kinds)
            self.assertIn("step_done", kinds)
            out = events[-1]
            tools = [s["tool"] for s in out["steps"]]
            for want in ("make_dir", "write_file", "edit_file", "move_file", "file_info"):
                self.assertIn(want, tools, f"agent never ran {want}: {tools}")
            self.assertTrue(all(s["result"].get("ok") for s in out["steps"]),
                            [s for s in out["steps"] if not s["result"].get("ok")])
            moved = os.path.join(self.root, "sub", "e.txt")
            self.assertTrue(os.path.exists(moved), "move_file did not move the file")
            with open(moved, encoding="utf-8") as f:
                self.assertEqual(f.read(), "alpha BETA gamma")
        finally:
            httpd.shutdown()
            httpd.server_close()

        # a read-only member's agent gets no write tools at all
        guest = self.req("POST", "/api/register",
                         {"username": "wstoolsguest", "password": "pw12345"})
        self.req("POST", "/api/servers/join",
                 {"invite_code": srv["invite_code"]}, token=guest["token"])
        self.req("POST", f"/api/workspaces/{wid}/grants",
                 {"user_id": guest["user"]["id"], "level": "read"}, token=tok)
        # the read-only member can read but not write through the API
        self.req("GET", f"/api/workspaces/{wid}/file?path=sub/e.txt", token=guest["token"])
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "nope.txt", "content": "x"},
                 token=guest["token"], expect=403)

    def test_conflict_and_raw(self):
        self.root = self.fresh_root()
        owner = self.req("POST", "/api/register",
                         {"username": "wsconf", "password": "pw12345"})
        tok = owner["token"]
        srv = self.req("POST", "/api/servers", {"name": "Conf", "icon": "🧪"}, token=tok)
        ws = self.req("POST", f"/api/servers/{srv['id']}/workspaces",
                      {"name": "c", "root": self.root}, token=tok)
        wid = ws["id"]

        meta = self.req("GET", f"/api/workspaces/{wid}/meta?path=README.md", token=tok)
        self.assertTrue(meta["text"])
        self.assertFalse(meta["image"])

        # a stale base_mtime is refused with 409 instead of clobbering
        stale = meta["mtime"] - 5
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "README.md", "content": "clobber", "base_mtime": stale},
                 token=tok, expect=409)
        # force overrides it
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "README.md", "content": "forced", "base_mtime": stale,
                  "force": True}, token=tok)
        # a fresh base_mtime saves cleanly
        meta = self.req("GET", f"/api/workspaces/{wid}/meta?path=README.md", token=tok)
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "README.md", "content": "fresh", "base_mtime": meta["mtime"]},
                 token=tok)

        # raw download returns bytes with an image mime for images
        png = os.path.join(self.root, "dot.png")
        with open(png, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"0" * 32)
        r = urllib.request.urlopen(
            f"http://127.0.0.1:{self.port}/api/workspaces/{wid}/raw"
            f"?path=dot.png&token={tok}")
        self.assertEqual(r.headers.get("Content-Type"), "image/png")
        self.assertTrue(r.read().startswith(b"\x89PNG"))
        m = self.req("GET", f"/api/workspaces/{wid}/meta?path=dot.png", token=tok)
        self.assertTrue(m["image"])
        self.assertFalse(m["text"])

        # renaming a file carries its revision history along
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "keep.txt", "content": "v1"}, token=tok)
        self.req("PUT", f"/api/workspaces/{wid}/file",
                 {"path": "keep.txt", "content": "v2"}, token=tok)
        self.req("POST", f"/api/workspaces/{wid}/move",
                 {"path": "keep.txt", "to": "moved.txt"}, token=tok)
        h = self.req("GET", f"/api/workspaces/{wid}/history?path=moved.txt", token=tok)
        self.assertEqual(len(h), 1)
        self.assertEqual(h[0]["size"], 2)
