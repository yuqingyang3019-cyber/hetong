#!/usr/bin/env python3
from __future__ import annotations

import json
import mimetypes
import os
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import TCPServer
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
PORT = int(os.getenv("PORT", "8000"))
AGENT_ENDPOINT = os.getenv("AGENT_ENDPOINT", "http://127.0.0.1:9010")
DINGTALK_CLIENT_ID = (os.getenv("DINGTALK_CLIENT_ID") or "").strip()
DINGTALK_CORP_ID = (os.getenv("DINGTALK_CORP_ID") or "").strip()


class H5Handler(SimpleHTTPRequestHandler):
    def translate_path(self, request_path: str) -> str:
        parsed = urlparse(request_path)
        path = unquote(parsed.path)
        if path in {"/", "/h5"}:
            path = "/index.html"

        relative = Path(path.lstrip("/"))
        target = (ROOT / relative).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            return str(ROOT / "__not_found__")
        return str(target)

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/config.js":
            body = (
                f"window.__AGENT_ENDPOINT__ = {json.dumps(AGENT_ENDPOINT)};\n"
                f"window.__DINGTALK_CLIENT_ID__ = {json.dumps(DINGTALK_CLIENT_ID)};\n"
                f"window.__DINGTALK_CORP_ID__ = {json.dumps(DINGTALK_CORP_ID)};\n"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        return super().do_GET()

    def guess_type(self, path: str) -> str:
        if path.endswith(".js"):
            return "application/javascript; charset=utf-8"
        if path.endswith(".css"):
            return "text/css; charset=utf-8"
        if path.endswith(".html"):
            return "text/html; charset=utf-8"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


def main() -> None:
    os.chdir(ROOT)
    with TCPServer(("", PORT), H5Handler) as httpd:
        print(f"H5 frontend listening on port {PORT}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
