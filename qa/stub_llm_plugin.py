"""Stub LLM that plays a plugin-tool agent.

First call → emits a plugin tool call; after TOOL RESULT → summarizes.
Also dumps the last system prompt to qa/plugin-sysprompt.json so the
driver can assert the agent was told about the connected plugin.
Port 8098 — parallel to stub_llm.py's 8099.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "plugin-sysprompt.json")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = json.dumps({"data": [{"id": "stub-agent"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(n) or b"{}")
        msgs = req.get("messages") or []
        if msgs:
            with open(OUT, "w", encoding="utf-8") as f:
                json.dump({"system": msgs[0].get("content", "")}, f)
        joined = " ".join(str(m.get("content") or "") for m in msgs)
        if "TOOL RESULT plugin" in joined:
            reply = "Checked your Gmail — the latest invoice is from " \
                    "billing@acme.example, subject INV-42."
        elif "already ran" in joined:
            reply = "Done — result is above."
        else:
            reply = json.dumps({"tool": "plugin", "args": {
                "plugin": "gmail", "action": "search", "q": "invoice"}})
        body = json.dumps({"choices": [{"message": {
            "role": "assistant", "content": reply},
            "finish_reason": "stop"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8098), H).serve_forever()
