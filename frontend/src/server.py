#!/usr/bin/env python3
from __future__ import annotations

import json
import mimetypes
import os
import base64
import hashlib
import hmac
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingTCPServer
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import urlencode, unquote, urlparse


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
DINGTALK_GETUSERINFO_URL = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo"
DINGTALK_USER_GET_URL = "https://oapi.dingtalk.com/topapi/v2/user/get"
_DINGTALK_TOKEN_CACHE: dict[str, tuple[str, float]] = {}
_DINGTALK_TOKEN_LOCK = threading.Lock()


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


def get_value(data: Any, *names: str) -> Any:
    if isinstance(data, dict):
        for name in names:
            if name in data:
                return data[name]
    for name in names:
        if hasattr(data, name):
            return getattr(data, name)
    return None


def to_plain_data(value: Any) -> Any:
    if hasattr(value, "to_map"):
        return value.to_map()
    if hasattr(value, "__dict__"):
        return {key: to_plain_data(item) for key, item in vars(value).items() if not key.startswith("_")}
    if isinstance(value, dict):
        return {key: to_plain_data(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_plain_data(item) for item in value]
    return value


def dingtalk_errcode_ok(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) == 0
    if isinstance(value, str):
        return value == "0" or value.lower() == "ok"
    return False


def summarize_dingtalk_response(body: Any) -> str:
    if isinstance(body, dict):
        code = body.get("code") or body.get("errcode")
        message = body.get("message") or body.get("errmsg")
        request_id = body.get("request_id") or body.get("requestId")
        parts = []
        if code is not None:
            parts.append(f"code={code}")
        if message:
            parts.append(f"message={message}")
        if request_id:
            parts.append(f"request_id={request_id}")
        return " ".join(parts) or "响应缺少错误信息"
    return str(body)[:300] if body is not None else "响应为空"


def format_sdk_error(exc: Exception) -> str:
    code = getattr(exc, "code", None)
    message = getattr(exc, "message", None) or str(exc)
    request_id = getattr(exc, "request_id", None) or getattr(exc, "requestId", None)
    parts = []
    if code:
        parts.append(f"code={code}")
    if message:
        parts.append(f"message={message}")
    if request_id:
        parts.append(f"request_id={request_id}")
    return " ".join(parts) or exc.__class__.__name__


def parse_dept_id_list(raw: Any) -> list[int]:
    if raw is None:
        return []
    if isinstance(raw, list):
        values: list[int] = []
        for item in raw:
            try:
                values.append(int(item))
            except (TypeError, ValueError):
                continue
        return values
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return parse_dept_id_list(parsed)
        try:
            return [int(raw)]
        except ValueError:
            return []
    try:
        return [int(raw)]
    except (TypeError, ValueError):
        return []


def make_oauth_client() -> tuple[Any, Any]:
    try:
        from alibabacloud_dingtalk.oauth2_1_0.client import Client as DingtalkOAuth2Client
        from alibabacloud_dingtalk.oauth2_1_0 import models as oauth_models
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk，无法调用钉钉 OAuth2 新版 SDK") from exc

    config = open_api_models.Config()
    config.protocol = "https"
    config.region_id = "central"
    return DingtalkOAuth2Client(config), oauth_models


def get_dingtalk_access_token(corp_id: str) -> str:
    cache_key = corp_id
    now = time.time()
    with _DINGTALK_TOKEN_LOCK:
        cached = _DINGTALK_TOKEN_CACHE.get(cache_key)
        if cached and now < cached[1] - 120:
            return cached[0]

    client, oauth_models = make_oauth_client()
    token_request = oauth_models.GetTokenRequest(
        client_id=DINGTALK_CLIENT_ID,
        client_secret=DINGTALK_CLIENT_SECRET,
        grant_type="client_credentials",
    )
    try:
        response = client.get_token(corp_id, token_request)
    except Exception as exc:
        raise RuntimeError(f"获取钉钉应用 access_token 失败：{format_sdk_error(exc)}") from exc

    body = to_plain_data(get_value(response, "body") or response)
    access_token = get_value(body, "access_token", "accessToken")
    if not isinstance(access_token, str) or not access_token:
        raise RuntimeError(f"钉钉 OAuth2 新版 SDK 未返回 access_token：{summarize_dingtalk_response(body)}")

    try:
        expires_in = int(get_value(body, "expires_in", "expiresIn") or 7200)
    except (TypeError, ValueError):
        expires_in = 7200
    with _DINGTALK_TOKEN_LOCK:
        _DINGTALK_TOKEN_CACHE[cache_key] = (access_token, now + max(60, expires_in))
    return access_token


def dingtalk_post_json(url: str, payload: dict, operation: str) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urlrequest.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlrequest.urlopen(req, timeout=15) as resp:
            body = resp.read()
    except urlerror.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed_error = json.loads(raw or "{}")
        except json.JSONDecodeError:
            parsed_error = raw[:300]
        raise RuntimeError(f"{operation} 失败：HTTP {exc.code} {summarize_dingtalk_response(parsed_error)}") from exc
    except urlerror.URLError as exc:
        raise RuntimeError(f"{operation} 网络请求失败：{exc.reason}") from exc

    try:
        parsed = json.loads(body.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{operation} 响应不是合法 JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError(f"{operation} 响应不是对象")
    if "errcode" in parsed and not dingtalk_errcode_ok(parsed.get("errcode")):
        raise RuntimeError(f"{operation} 失败：{summarize_dingtalk_response(parsed)}")
    return parsed


def dingtalk_topapi_post(url: str, access_token: str, payload: dict, operation: str) -> dict:
    return dingtalk_post_json(f"{url}?{urlencode({'access_token': access_token})}", payload, operation)


def exchange_dingtalk_code(code: str, corp_id: str) -> dict:
    if not dingtalk_configured():
        raise RuntimeError("未配置钉钉新版服务端 SDK 凭证")

    access_token = get_dingtalk_access_token(corp_id)
    user_body = dingtalk_topapi_post(DINGTALK_GETUSERINFO_URL, access_token, {"code": code}, "通过免登码获取钉钉用户信息")
    result = user_body.get("result") if isinstance(user_body.get("result"), dict) else {}
    userid = str(result.get("userid") or "").strip()
    if not userid:
        raise RuntimeError(f"钉钉免登未返回 userid：{summarize_dingtalk_response(user_body)}")

    detail_body = dingtalk_topapi_post(
        DINGTALK_USER_GET_URL,
        access_token,
        {"userid": userid, "language": "zh_CN"},
        "获取钉钉用户详情",
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
        "dept_ids": parse_dept_id_list(detail.get("dept_id_list")),
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
            print(f"[bff.auth] dingtalk login failed: {exc}", file=sys.stderr, flush=True)
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
