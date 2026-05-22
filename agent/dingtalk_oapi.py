"""钉钉企业内部应用旧版 OAPI 调用与 access_token 内存缓存。"""

from __future__ import annotations

import json
import threading
import time
from typing import Any
from urllib.parse import quote

import requests

_GETTOKEN_URL = "https://oapi.dingtalk.com/gettoken"
_GETUSERINFO_URL = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo"
_USER_GET_URL = "https://oapi.dingtalk.com/topapi/v2/user/get"
_DEPT_GET_URL = "https://oapi.dingtalk.com/topapi/v2/department/get"

_lock = threading.Lock()
_cached_access_token: str | None = None
_cached_expires_at: float = 0.0


def clear_token_cache() -> None:
    global _cached_access_token, _cached_expires_at
    with _lock:
        _cached_access_token = None
        _cached_expires_at = 0.0


def _dingtalk_errcode_ok(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) == 0
    if isinstance(value, str):
        return value == "0" or value.lower() == "ok"
    return False


def get_app_credentials() -> tuple[str, str]:
    import os

    key = (os.getenv("DINGTALK_APP_KEY") or os.getenv("DINGTALK_CLIENT_ID") or "").strip()
    secret = (os.getenv("DINGTALK_APP_SECRET") or os.getenv("DINGTALK_CLIENT_SECRET") or "").strip()
    return key, secret


def get_app_access_token() -> str:
    """获取企业内部应用 access_token，带进程内缓存（提前 120 秒刷新）。"""
    global _cached_access_token, _cached_expires_at

    app_key, app_secret = get_app_credentials()
    if not app_key or not app_secret:
        raise RuntimeError("未配置 DINGTALK_APP_KEY/DINGTALK_APP_SECRET（或兼容的 CLIENT_ID/SECRET）")

    now = time.time()
    with _lock:
        if _cached_access_token and now < _cached_expires_at - 120:
            return _cached_access_token

    resp = requests.get(
        _GETTOKEN_URL,
        params={"appkey": app_key, "appsecret": app_secret},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if not _dingtalk_errcode_ok(data.get("errcode")):
        raise RuntimeError(f"钉钉 gettoken 失败: errcode={data.get('errcode')} errmsg={data.get('errmsg')}")

    token = data.get("access_token")
    if not token or not isinstance(token, str):
        raise RuntimeError("钉钉 gettoken 未返回 access_token")

    expires_in = int(data.get("expires_in") or 7200)
    with _lock:
        _cached_access_token = token
        _cached_expires_at = now + max(60, expires_in)

    return token


def get_userid_by_auth_code(access_token: str, auth_code: str) -> dict[str, Any]:
    resp = requests.post(
        f"{_GETUSERINFO_URL}?access_token={quote(access_token, safe='')}",
        json={"code": auth_code},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if not _dingtalk_errcode_ok(data.get("errcode")):
        raise RuntimeError(f"钉钉 getuserinfo 失败: errcode={data.get('errcode')} errmsg={data.get('errmsg')}")

    result = data.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("钉钉 getuserinfo 返回缺少 result")
    userid = result.get("userid")
    if not userid:
        raise RuntimeError("钉钉 getuserinfo 未返回 userid")
    return result


def get_user_detail(access_token: str, userid: str, language: str = "zh_CN") -> dict[str, Any]:
    resp = requests.post(
        f"{_USER_GET_URL}?access_token={quote(access_token, safe='')}",
        json={"userid": userid, "language": language},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if not _dingtalk_errcode_ok(data.get("errcode")):
        raise RuntimeError(f"钉钉 user/get 失败: errcode={data.get('errcode')} errmsg={data.get('errmsg')}")

    result = data.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("钉钉 user/get 返回缺少 result")
    return result


def parse_dept_id_list(raw: Any) -> list[int]:
    if raw is None:
        return []
    if isinstance(raw, list):
        out: list[int] = []
        for x in raw:
            try:
                out.append(int(x))
            except (TypeError, ValueError):
                continue
        return out
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parse_dept_id_list(parsed)
        except json.JSONDecodeError:
            pass
        try:
            return [int(raw)]
        except ValueError:
            return []
    try:
        return [int(raw)]
    except (TypeError, ValueError):
        return []


def get_department_name(access_token: str, dept_id: int) -> str | None:
    try:
        resp = requests.post(
            f"{_DEPT_GET_URL}?access_token={quote(access_token, safe='')}",
            json={"dept_id": dept_id},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if not _dingtalk_errcode_ok(data.get("errcode")):
            return None
        result = data.get("result")
        if isinstance(result, dict):
            name = result.get("name")
            return str(name) if name else None
    except Exception:
        return None
    return None


def enrich_user_profile(user: dict[str, Any]) -> dict[str, Any]:
    """预留：对接企业权限中台或花名册时在此扩展。"""
    return dict(user)
