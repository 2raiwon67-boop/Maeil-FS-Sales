import base64
from http.server import HTTPServer, BaseHTTPRequestHandler

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n).decode()
        b64 = body.split(',', 1)[1] if ',' in body else body
        open('chart-map-raw.png', 'wb').write(base64.b64decode(b64))
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, *a):
        pass

HTTPServer(('127.0.0.1', 8901), H).serve_forever()
