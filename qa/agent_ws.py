"""End-to-end check of the agent↔workspace tool loop against qa/stub_llm.py.

Run from the repo root:  backend/.venv/Scripts/python.exe qa/agent_ws.py
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(BASE, "backend", ".venv", "Scripts", "python.exe")
API = "http://127.0.0.1:8075"


def req(method, path, body=None, token=None):
    r = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(r, timeout=60) as res:
        return json.loads(res.read() or b"null")


def main():
    stub = subprocess.Popen([PY, os.path.join(BASE, "qa", "stub_llm.py")],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        tok = req("POST", "/api/register",
                  {"username": f"wsagent{int(time.time())}", "password": "pw12345"})["token"]
        srv = req("POST", "/api/servers", {"name": "Agent WS", "icon": "🧪"}, token=tok)
        root = tempfile.mkdtemp(prefix="st-agentws-")
        with open(os.path.join(root, "README.md"), "w", encoding="utf-8") as f:
            f.write("# demo\n\nhello from the fixture\n")
        ws = req("POST", f"/api/servers/{srv['id']}/workspaces",
                 {"name": "demo", "root": root}, token=tok)
        agent = req("POST", "/api/agents", {
            "name": f"StubCoder{int(time.time())}", "icon": "🤖",
            "tagline": "stub", "system_prompt": "You are a coding agent.",
            "api_kind": "openai", "api_url": "http://127.0.0.1:8099/v1",
            "model": "stub-agent", "visibility": "private"}, token=tok)
        out = req("POST", f"/api/workspaces/{ws['id']}/agent",
                  {"agent_id": agent["id"], "message": "read the readme then write notes"},
                  token=tok)
        print("reply:", out["reply"])
        print("steps:", [(s["tool"], s["result"].get("ok")) for s in out["steps"]])
        notes = os.path.join(root, "NOTES.md")
        assert os.path.exists(notes), "agent never wrote NOTES.md"
        with open(notes, encoding="utf-8") as f:
            print("NOTES.md:", f.read().strip())
        acts = req("GET", f"/api/workspaces/{ws['id']}/audit", token=tok)
        print("audit:", [(a["action"], a["path"], a["agent"]["name"] if a["agent"] else None)
                         for a in acts[:5]])
        assert any(a["action"] == "create" and a["path"] == "NOTES.md" and a["agent"]
                   for a in acts), "agent write not attributed in the audit log"
        print("OK — agent tool loop works and is attributed.")
    finally:
        stub.terminate()


if __name__ == "__main__":
    main()
