"""Tiny OpenAI-compatible stub that plays a tool-calling agent.

First call → asks to read README.md, second → writes NOTES.md, third → answers.
Used by qa/agent_ws.py to prove the workspace tool loop without a real model.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE = {"n": 0}


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
        joined = " ".join(str(m.get("content") or "") for m in msgs)
        STATE["n"] += 1
        if "TOOL RESULT read_file" in joined:
            reply = json.dumps({"tool": "write_file", "args": {
                "path": "NOTES.md", "content": "# notes\n\nwritten by the stub agent\n",
                "note": "stub agent wrote notes"}})
        elif "TOOL RESULT write_file" in joined:
            reply = "Done — I read README.md and wrote NOTES.md."
        else:
            reply = json.dumps({"tool": "read_file", "args": {"path": "README.md"}})
        body = json.dumps({"choices": [{"message": {"role": "assistant", "content": reply},
                                        "finish_reason": "stop"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8099), H).serve_forever()
