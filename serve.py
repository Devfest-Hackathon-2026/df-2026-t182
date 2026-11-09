#!/usr/bin/env python3
"""Static server for 『ミーを信じて』 with caching disabled (so edits show on reload).

    python3 serve.py [port]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5700


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        if ' 200 ' in fmt % args or ' 304 ' in fmt % args:
            return
        super().log_message(fmt, *args)


if __name__ == '__main__':
    with ThreadingHTTPServer(('0.0.0.0', PORT), Handler) as server:
        print(f'ミーを信じて → http://localhost:{PORT}/  (LAN: http://<MacのIP>:{PORT}/)', flush=True)
        server.serve_forever()
