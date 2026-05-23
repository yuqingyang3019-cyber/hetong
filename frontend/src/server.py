#!/usr/bin/env python3
from __future__ import annotations

import json
import mimetypes
import os
import base64
import hashlib
import hmac
import time
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingTCPServer
from urllib import request as urlrequest
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
PORT = int(os.getenv("PORT", "8000"))
AGENT_ENDPOINT = os.getenv("AGENT_ENDPOINT", "http://127.0.0.1:9010")
DINGTALK_CLIENT_ID = (os.getenv("DINGTALK_CLIENT_ID") or "").strip()
DINGTALK_CLIENT_SECRET = (os.getenv("DINGTALK_CLIENT_SECRET") or "").strip()
DINGTALK_CORP_ID = (os.getenv("DINGTALK_CORP_ID") or "").strip()
APP_SESSION_SECRET = (os.getenv("APP_SESSION_SECRET") or "").strip()
AGENT_TOKEN_TTL_SEC = int(os.getenv("AGENT_TOKEN_TTL_SEC", "1800"))
H5_SESSION_TTL_SEC = int(os.getenv("H5_SESSION_TTL_SEC", str(7 * 24 * 3600)))
H5_SESSION_COOKIE_NAME = "hetong_h5_session"
BFF_PREFIX = "/bff/auth"
def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    padding = 4 - len(value) % 4
    if padding != 4:
        value += "=" * padding
    return base64.urlsafe_b64decode(value.encode("ascii"))


def sign_payload(payload: dict) -> str:
    if not APP_SESSION_SECRET:
        raise RuntimeError("未配置 APP_SESSION_SECRET，无法签发登录态")
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body_b64 = b64url_encode(body)
    sig = hmac.new(APP_SESSION_SECRET.encode("utf-8"), body_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body_b64}.{sig}"


def verify_payload(raw: str | None, expected_type: str) -> dict | None:
    if not raw or not APP_SESSION_SECRET or "." not in raw:
        return None
    body_b64, sig = raw.rsplit(".", 1)
    expected = hmac.new(APP_SESSION_SECRET.encode("utf-8"), body_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        payload = json.loads(b64url_decode(body_b64))
    except Exception:
        return None
    if not isinstance(payload, dict) or payload.get("typ") != expected_type:
        return None
    try:
        if time.time() > float(payload.get("exp") or 0):
            return None
    except (TypeError, ValueError):
        return None
    return payload


def public_user_from_session(payload: dict) -> dict:
    return {
        "userid": payload.get("userid"),
        "name": payload.get("name"),
        "nick": payload.get("nick") or None,
        "mobile": payload.get("mobile") or "",
        "title": payload.get("title") or "",
        "jobNumber": payload.get("job_number") or "",
        "email": payload.get("email") or "",
        "avatar": payload.get("avatar") or "",
        "deptIds": payload.get("dept_ids") or [],
        "deptNames": payload.get("dept_names") or [],
        "unionid": payload.get("unionid") or "",
    }


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def make_error(code: str, message: str, detail: str | None = None) -> dict:
    body = {"ok": False, "code": code, "message": message}
    if detail:
        body["detail"] = detail
    return body


def read_json_body(handler: SimpleHTTPRequestHandler) -> dict:
    raw = handler.read_request_body() or b"{}"
    try:
        value = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValueError("请求体不是合法 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("请求体必须是 JSON 对象")
    return value


def sign_agent_token(session_payload: dict) -> tuple[str, float]:
    exp = time.time() + AGENT_TOKEN_TTL_SEC
    token_payload = {
        "typ": "agent",
        "iss": "hetong-h5-bff",
        "exp": exp,
        "userid": session_payload.get("userid"),
        "name": session_payload.get("name"),
        "nick": session_payload.get("nick") or "",
        "mobile": session_payload.get("mobile") or "",
        "title": session_payload.get("title") or "",
        "job_number": session_payload.get("job_number") or "",
        "email": session_payload.get("email") or "",
        "avatar": session_payload.get("avatar") or "",
        "dept_ids": session_payload.get("dept_ids") or [],
        "dept_names": session_payload.get("dept_names") or [],
        "unionid": session_payload.get("unionid") or "",
    }
    return sign_payload(token_payload), exp


def get_h5_session(handler: SimpleHTTPRequestHandler) -> dict | None:
    cookie_header = handler.headers.get("Cookie") or ""
    cookies: dict[str, str] = {}
    for part in cookie_header.split(";"):
        if "=" not in part:
            continue
        name, value = part.strip().split("=", 1)
        cookies[name] = value
    return verify_payload(cookies.get(H5_SESSION_COOKIE_NAME), "h5")


def dingtalk_configured() -> bool:
    return bool(DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET and DINGTALK_CORP_ID)


def dingtalk_post_json(url: str, payload: dict, headers: dict[str, str] | None = None) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)
    req = urlrequest.Request(url, data=data, headers=request_headers, method="POST")
    with urlrequest.urlopen(req, timeout=15) as resp:
        body = resp.read()
    parsed = json.loads(body.decode("utf-8") or "{}")
    if not isinstance(parsed, dict):
        raise RuntimeError("钉钉 SDK 响应不是对象")
    return parsed


def exchange_dingtalk_code(code: str, corp_id: str) -> dict:
    if not dingtalk_configured():
        raise RuntimeError("未配置钉钉新版服务端 SDK 凭证")

    token_body = dingtalk_post_json(
        f"https://api.dingtalk.com/v1.0/oauth2/{corp_id}/token",
        {
            "client_id": DINGTALK_CLIENT_ID,
            "client_secret": DINGTALK_CLIENT_SECRET,
            "grant_type": "client_credentials",
        },
    )
    access_token = token_body.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise RuntimeError("钉钉新版服务端 SDK 未返回 access_token")

    user_body = dingtalk_post_json(
        "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo",
        {"code": code},
        headers={"x-acs-dingtalk-access-token": access_token},
    )
    result = user_body.get("result") if isinstance(user_body.get("result"), dict) else {}
    userid = str(result.get("userid") or "").strip()
    if not userid:
        raise RuntimeError("钉钉免登未返回 userid")

    detail_body = dingtalk_post_json(
        "https://oapi.dingtalk.com/topapi/v2/user/get",
        {"userid": userid, "language": "zh_CN"},
        headers={"x-acs-dingtalk-access-token": access_token},
    )
    detail = detail_body.get("result") if isinstance(detail_body.get("result"), dict) else {}
    return {
        "userid": userid,
        "name": detail.get("name") or result.get("name") or userid,
        "nick": detail.get("nick") or result.get("name") or "",
        "mobile": str(detail.get("mobile") or ""),
        "title": str(detail.get("title") or ""),
        "job_number": str(detail.get("job_number") or ""),
        "email": str(detail.get("email") or ""),
        "avatar": str(detail.get("avatar") or result.get("avatar") or ""),
        "dept_ids": detail.get("dept_id_list") if isinstance(detail.get("dept_id_list"), list) else [],
        "dept_names": [],
        "unionid": str(detail.get("unionid") or result.get("unionid") or ""),
    }


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

        if path.startswith(f"{BFF_PREFIX}/"):
            self.handle_bff_get(path)
            return

        return super().do_GET()

    def do_HEAD(self) -> None:
        if urlparse(self.path).path.startswith(f"{BFF_PREFIX}/"):
            self.handle_bff_get(urlparse(self.path).path, write_body=False)
            return

        return super().do_HEAD()

    def do_POST(self) -> None:
        self.handle_bff_post_or_404()

    def do_PUT(self) -> None:
        self.handle_bff_post_or_404()

    def do_PATCH(self) -> None:
        self.handle_bff_post_or_404()

    def do_DELETE(self) -> None:
        self.handle_bff_post_or_404()

    def do_OPTIONS(self) -> None:
        self.handle_bff_post_or_404()

    def handle_bff_post_or_404(self) -> None:
        path = urlparse(self.path).path
        if path.startswith(f"{BFF_PREFIX}/"):
            self.handle_bff_post(path)
            return

        self.send_error(404, "Not found")

    def send_json(self, status: int, payload: dict, extra_headers: dict[str, str] | None = None, write_body: bool = True) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if write_body and self.command != "HEAD":
            self.wfile.write(body)

    def handle_bff_get(self, path: str, write_body: bool = True) -> None:
        if path == f"{BFF_PREFIX}/config":
            self.send_json(200, {
                "ok": True,
                "corpId": DINGTALK_CORP_ID or None,
                "clientId": DINGTALK_CLIENT_ID or None,
                "agentBaseUrl": AGENT_ENDPOINT.rstrip("/"),
                "agentTokenTtlSeconds": AGENT_TOKEN_TTL_SEC,
                "dingtalkConfigured": dingtalk_configured(),
            }, write_body=write_body)
            return
        if path == f"{BFF_PREFIX}/me":
            session = get_h5_session(self)
            if not session:
                self.send_json(200, {"ok": True, "loggedIn": False, "user": None}, write_body=write_body)
                return
            self.send_json(200, {
                "ok": True,
                "loggedIn": True,
                "user": public_user_from_session(session),
                "agentTokenExpiresAt": session.get("agent_exp"),
            }, write_body=write_body)
            return
        self.send_json(404, make_error("NOT_FOUND", "接口不存在"), write_body=write_body)

    def handle_bff_post(self, path: str) -> None:
        try:
            if path == f"{BFF_PREFIX}/dingtalk-login":
                self.handle_dingtalk_login()
                return
            if path == f"{BFF_PREFIX}/agent-token":
                self.handle_agent_token()
                return
            self.send_json(404, make_error("NOT_FOUND", "接口不存在"))
        except ValueError as exc:
            self.send_json(400, make_error("INVALID_ARGUMENT", str(exc)))
        except RuntimeError as exc:
            self.send_json(502, make_error("DINGTALK_AUTH_FAILED", "钉钉免登失败", str(exc)))

    def set_h5_cookie(self, token: str, max_age: int) -> str:
        secure = "Secure; " if (self.headers.get("X-Forwarded-Proto") or "").lower() == "https" else ""
        return f"{H5_SESSION_COOKIE_NAME}={token}; Max-Age={max_age}; Path=/; HttpOnly; SameSite=Lax; {secure}".strip()

    def handle_dingtalk_login(self) -> None:
        payload = read_json_body(self)
        code = str(payload.get("code") or "").strip()
        corp_id = str(payload.get("corpId") or DINGTALK_CORP_ID or "").strip()
        if not code:
            self.send_json(400, make_error("INVALID_ARGUMENT", "缺少免登授权码 code"))
            return
        if not corp_id:
            self.send_json(400, make_error("INVALID_ARGUMENT", "缺少 corpId"))
            return
        session_payload = exchange_dingtalk_code(code, corp_id)
        session_payload.update({
            "typ": "h5",
            "exp": time.time() + H5_SESSION_TTL_SEC,
        })
        agent_token, agent_exp = sign_agent_token(session_payload)
        session_payload["agent_exp"] = agent_exp
        session_token = sign_payload(session_payload)
        self.send_json(200, {
            "ok": True,
            "user": public_user_from_session(session_payload),
            "agentBaseUrl": AGENT_ENDPOINT.rstrip("/"),
            "agentAccessToken": agent_token,
            "expiresAt": agent_exp,
        }, {"Set-Cookie": self.set_h5_cookie(session_token, H5_SESSION_TTL_SEC)})

    def handle_agent_token(self) -> None:
        session = get_h5_session(self)
        if not session:
            self.send_json(401, make_error("AUTH_REQUIRED", "登录已失效，请重新进入钉钉应用"))
            return
        agent_token, agent_exp = sign_agent_token(session)
        session["agent_exp"] = agent_exp
        session_token = sign_payload(session)
        self.send_json(200, {
            "ok": True,
            "agentBaseUrl": AGENT_ENDPOINT.rstrip("/"),
            "agentAccessToken": agent_token,
            "expiresAt": agent_exp,
        }, {"Set-Cookie": self.set_h5_cookie(session_token, H5_SESSION_TTL_SEC)})

    def read_request_body(self) -> bytes | None:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return None
        return self.rfile.read(length)

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
