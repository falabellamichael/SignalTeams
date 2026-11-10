import http.server, socket
class S(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"HIT {self.path}", flush=True)
        self.send_response(200); self.end_headers(); self.wfile.write(b"probe ok")
    def log_message(self, *a): pass
S(("::", 9999), H).serve_forever()
