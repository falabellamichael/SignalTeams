import json, socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class H(BaseHTTPRequestHandler):
    timeout = 10
    def setup(self):
        super().setup()
        self.connection.settimeout(10)
    def _j(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        print("GET", self.path, flush=True)
        if self.path.startswith("/api/onboard/info"):
            self._j({"genesis_pubkey":"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=","network_id":"testnet","dns_base_domain":"trycloudflare.com","hosts":[]})
        elif self.path.startswith("/api/health"):
            self._j({"ok":True,"service":"tunnel-test"})
        elif self.path.startswith("/api/tier1/authority"):
            self._j({"chain":"test","epoch":1,"handoffs":[],"anchor":"x"})
        else:
            self._j({"ok":True,"path":self.path})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(min(n, 65536))
        print("POST", self.path, body[:200], flush=True)
        self._j({"ok":True,"received":body[:100].decode('utf-8','replace')})
    def log_message(self, *a): pass

ThreadingHTTPServer(("127.0.0.1", 8901), H).serve_forever()
