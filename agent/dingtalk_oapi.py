"""DingTalk OAuth2 access token helper backed by the official SDK."""

from __future__ import annotations

import os
import json
import threading
import time
from typing import Any

_lock = threading.Lock()
_cached_access_tokens: dict[str, tuple[str, float]] = {}


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


def _contact_client() -> Any:
    try:
        from alibabacloud_dingtalk.contact_1_0.client import Client as ContactClient
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk Contact SDK，无法查询钉钉用户详情") from exc

    config = open_api_models.Config()
    config.protocol = "https"
    config.region_id = "central"
    return ContactClient(config)


def _contact_models() -> Any:
    try:
        from alibabacloud_dingtalk.contact_1_0 import models as contact_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk Contact SDK，无法构造钉钉用户详情请求") from exc
    return contact_models


def _openapi_client() -> Any:
    try:
        from alibabacloud_tea_openapi.client import Client as OpenApiClient
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_tea_openapi，无法调用钉钉免登接口") from exc

    config = open_api_models.Config()
    config.protocol = "https"
    config.endpoint = "oapi.dingtalk.com"
    return OpenApiClient(config)


def _openapi_models() -> Any:
    try:
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_tea_openapi，无法构造钉钉免登请求") from exc
    return open_api_models


def _runtime_options() -> Any:
    try:
        from alibabacloud_tea_util import models as util_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_tea_util，无法调用钉钉接口") from exc
    return util_models.RuntimeOptions()


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


def dingtalk_configured() -> bool:
    client_id, client_secret, corp_id = get_client_credentials()
    return bool(client_id and client_secret and corp_id)


def _parse_dept_ids(raw: Any) -> list[int]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [int(item) for item in raw if str(item).strip().isdigit()]
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            return _parse_dept_ids(parsed)
        except Exception:
            return [int(text)] if text.isdigit() else []
    try:
        return [int(raw)]
    except (TypeError, ValueError):
        return []


def _normalize_api_error(body: Any) -> None:
    errcode = _get_value(body, "errcode", "code")
    if errcode in (None, "", 0, "0"):
        return
    message = _get_value(body, "errmsg", "message") or f"钉钉接口返回 errcode={errcode}"
    raise RuntimeError(str(message))


def get_log_free_user_info(code: str, app_access_token: str) -> dict[str, Any]:
    """Resolve a DingTalk log-free auth code to userid using the official OpenAPI SDK."""
    openapi_models = _openapi_models()
    request = openapi_models.OpenApiRequest(
        query={"access_token": app_access_token},
        body={"code": code},
    )
    params = openapi_models.Params(
        action="OapiV2UserGetuserinfo",
        version="topapi_2.0",
        protocol="HTTP",
        pathname="/topapi/v2/user/getuserinfo",
        method="POST",
        auth_type="Anonymous",
        style="ROA",
        req_body_type="json",
        body_type="json",
    )
    response = _openapi_client().execute(params, request, _runtime_options())
    body = _response_body(response)
    body_map = body.to_map() if hasattr(body, "to_map") else body
    _normalize_api_error(body_map)
    result = _get_value(body_map, "result") or body_map
    userid = str(_get_value(result, "userid", "userId", "user_id") or "").strip()
    if not userid:
        raise RuntimeError("钉钉免登接口未返回 userid")
    return result if isinstance(result, dict) else result.to_map()


def get_contact_detail(userid: str, app_access_token: str) -> dict[str, Any]:
    contact_models = _contact_models()
    headers = contact_models.GetUserHeaders()
    setattr(headers, "x_acs_dingtalk_access_token", app_access_token)
    response = _contact_client().get_user_with_options(userid, headers, _runtime_options())
    body = _response_body(response)
    body_map = body.to_map() if hasattr(body, "to_map") else body
    return body_map if isinstance(body_map, dict) else {}


def exchange_dingtalk_code(code: str, corp_id: str) -> dict[str, Any]:
    if not dingtalk_configured():
        raise RuntimeError("未配置钉钉新版服务端 SDK 凭证")
    _client_id, _client_secret, configured_corp_id = get_client_credentials()
    if corp_id != configured_corp_id:
        raise RuntimeError("corpId 与服务端配置不一致")
    app_access_token = get_app_access_token(corp_id)
    login_info = get_log_free_user_info(code, app_access_token)
    login_userid = str(_get_value(login_info, "userid", "userId", "user_id") or "").strip()
    try:
        detail = get_contact_detail(login_userid, app_access_token)
    except Exception:
        detail = {}
    userid = str(_get_value(detail, "userid", "userId", "user_id") or login_userid).strip()
    if not userid:
        raise RuntimeError("钉钉用户详情未返回 userid")
    return {
        "userid": userid,
        "name": _get_value(detail, "name") or _get_value(login_info, "name") or _get_value(detail, "nick") or userid,
        "nick": _get_value(detail, "nick") or "",
        "mobile": str(_get_value(detail, "mobile") or ""),
        "title": str(_get_value(detail, "title") or ""),
        "job_number": str(_get_value(detail, "jobNumber", "job_number") or ""),
        "email": str(_get_value(detail, "email") or ""),
        "avatar": str(_get_value(detail, "avatar") or ""),
        "dept_ids": _parse_dept_ids(_get_value(detail, "deptIdList", "dept_id_list")),
        "dept_names": _get_value(detail, "deptNames") or [],
        "unionid": str(_get_value(detail, "unionid", "unionId") or _get_value(login_info, "unionid", "unionId") or ""),
    }

