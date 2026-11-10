"""Minimal OpenAI-compatible streaming stub for verifying the watch->mesh->hive AI path.
POST /v1/chat/completions -> SSE chunks of choices[0].delta.content, ends [DONE].
GET  /v1/models -> model list. Binds 127.0.0.1:8099.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

REPLY = ("MESH AI ONLINE — the watch reached the hive through the encrypted "
         "Lemonade Nexus tunnel and this reply streamed back over the mesh. "
         "Every token below travelled watch -> egress -> backend -> LLM -> egress -> watch.")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models") or self.path == "/v1/models":
            self._send(200, json.dumps({"object": "list", "data": [
                {"id": "mesh-stub", "object": "model"}]}))
        else:
            self._send(200, json.dumps({"ok": True}))

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        # stream the reply word-by-word as OpenAI SSE deltas
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        words = REPLY.split(" ")
        buf = ""
        for w in words:
            buf += w + " "
            chunk = {"choices": [{"delta": {"content": w + " "},
                                  "index": 0, "finish_reason": None}]}
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            self.wfile.flush()
        fin = {"choices": [{"delta": {}, "index": 0, "finish_reason": "stop"}]}
        self.wfile.write(("data: " + json.dumps(fin) + "\n\n").encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8099), H).serve_forever()
