#!/usr/bin/env python3
from __future__ import annotations

import json
import mimetypes
import os
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingTCPServer
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
PORT = int(os.getenv("PORT", "8000"))
AGENT_ENDPOINT = os.getenv("AGENT_ENDPOINT", "http://127.0.0.1:9010")
DINGTALK_CLIENT_ID = (os.getenv("DINGTALK_CLIENT_ID") or "").strip()
DINGTALK_CORP_ID = (os.getenv("DINGTALK_CORP_ID") or "").strip()
PROXY_PREFIXES = ("/api", "/ag-ui", "/contracts", "/uploads")
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
}


def is_proxy_path(path: str) -> bool:
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in PROXY_PREFIXES)


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
        path = urlparse(self.path).path
        if path == "/config.js":
            body = (
                f"window.__DINGTALK_CLIENT_ID__ = {json.dumps(DINGTALK_CLIENT_ID)};\n"
                f"window.__DINGTALK_CORP_ID__ = {json.dumps(DINGTALK_CORP_ID)};\n"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if is_proxy_path(path):
            self.proxy_to_agent()
            return

        return super().do_GET()

    def do_HEAD(self) -> None:
        if is_proxy_path(urlparse(self.path).path):
            self.proxy_to_agent()
            return

        return super().do_HEAD()

    def do_POST(self) -> None:
        self.proxy_to_agent_or_404()

    def do_PUT(self) -> None:
        self.proxy_to_agent_or_404()

    def do_PATCH(self) -> None:
        self.proxy_to_agent_or_404()

    def do_DELETE(self) -> None:
        self.proxy_to_agent_or_404()

    def do_OPTIONS(self) -> None:
        self.proxy_to_agent_or_404()

    def proxy_to_agent_or_404(self) -> None:
        if is_proxy_path(urlparse(self.path).path):
            self.proxy_to_agent()
            return

        self.send_error(404, "Not found")

    def proxy_to_agent(self) -> None:
        target_url = f"{AGENT_ENDPOINT.rstrip('/')}{self.path}"
        body = self.read_request_body()
        headers = self.proxy_request_headers()
        req = urlrequest.Request(target_url, data=body, headers=headers, method=self.command)

        try:
            with urlrequest.urlopen(req, timeout=300) as upstream:
                response_body = upstream.read()
                self.send_proxy_response(upstream.status, upstream.headers, response_body)
        except urlerror.HTTPError as exc:
            response_body = exc.read()
            self.send_proxy_response(exc.code, exc.headers, response_body)
        except (urlerror.URLError, OSError) as exc:
            response_body = json.dumps(
                {"detail": f"Agent proxy request failed: {exc}"}, ensure_ascii=False
            ).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response_body)

    def read_request_body(self) -> bytes | None:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return None
        return self.rfile.read(length)

    def proxy_request_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        for key, value in self.headers.items():
            lower_key = key.lower()
            if lower_key == "host" or lower_key in HOP_BY_HOP_HEADERS:
                continue
            headers[key] = value

        if self.headers.get("Host"):
            headers["X-Forwarded-Host"] = self.headers["Host"]
        headers["X-Forwarded-Proto"] = self.headers.get("X-Forwarded-Proto", "https")
        return headers

    def send_proxy_response(self, status: int, response_headers, response_body: bytes) -> None:
        self.send_response(status)
        for key, value in response_headers.items():
            lower_key = key.lower()
            if lower_key == "set-cookie" or lower_key in HOP_BY_HOP_HEADERS:
                continue
            self.send_header(key, value)

        for cookie in response_headers.get_all("Set-Cookie") or []:
            self.send_header("Set-Cookie", cookie)

        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(response_body)

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
    with ThreadingTCPServer(("", PORT), H5Handler) as httpd:
        print(f"H5 frontend listening on port {PORT}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
