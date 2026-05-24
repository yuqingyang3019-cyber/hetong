"""DingTalk OAuth2 access token helper backed by the official SDK."""

from __future__ import annotations

import os
import threading
import time
from typing import Any

_lock = threading.Lock()
_cached_access_tokens: dict[str, tuple[str, float]] = {}


def clear_token_cache() -> None:
    with _lock:
        _cached_access_tokens.clear()


def get_client_credentials() -> tuple[str, str, str]:
    client_id = (os.getenv("DINGTALK_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("DINGTALK_CLIENT_SECRET") or "").strip()
    corp_id = (os.getenv("DINGTALK_CORP_ID") or "").strip()
    return client_id, client_secret, corp_id


def _response_body(response: Any) -> Any:
    if hasattr(response, "body"):
        return response.body
    return response


def _get_value(data: Any, *names: str) -> Any:
    if isinstance(data, dict):
        for name in names:
            if name in data:
                return data[name]
    for name in names:
        if hasattr(data, name):
            return getattr(data, name)
    return None


def _oauth_client() -> Any:
    try:
        from alibabacloud_dingtalk.oauth2_1_0.client import Client as OAuthClient
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk OAuth2 SDK，无法获取钉钉 access_token") from exc

    config = open_api_models.Config()
    config.protocol = "https"
    config.region_id = "central"
    return OAuthClient(config)


def _oauth_models() -> Any:
    try:
        from alibabacloud_dingtalk.oauth2_1_0 import models as oauth_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk OAuth2 SDK，无法构造钉钉 token 请求") from exc
    return oauth_models


def get_app_access_token(corp_id: str | None = None) -> str:
    """Fetch an app access token with the official DingTalk OAuth2 SDK."""
    now = time.time()
    client_id, client_secret, configured_corp_id = get_client_credentials()
    effective_corp_id = (corp_id or configured_corp_id).strip()
    if not client_id or not client_secret or not effective_corp_id:
        raise RuntimeError("新版钉钉凭证需要同时配置 DINGTALK_CLIENT_ID、DINGTALK_CLIENT_SECRET 和 DINGTALK_CORP_ID")

    cache_key = f"oauth:{effective_corp_id}"
    with _lock:
        cached = _cached_access_tokens.get(cache_key)
        if cached and now < cached[1] - 120:
            return cached[0]

    oauth_models = _oauth_models()
    request = oauth_models.GetTokenRequest(
        client_id=client_id,
        client_secret=client_secret,
        grant_type="client_credentials",
    )
    response = _oauth_client().get_token(effective_corp_id, request)
    body = _response_body(response)
    token = _get_value(body, "accessToken", "access_token")
    if not token:
        raise RuntimeError("钉钉 OAuth2 SDK 未返回 access_token")
    expires_in = int(_get_value(body, "expiresIn", "expires_in") or 7200)
    with _lock:
        _cached_access_tokens[cache_key] = (str(token), now + max(60, expires_in))
    return str(token)

