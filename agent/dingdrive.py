from __future__ import annotations

import os
import mimetypes
from pathlib import Path
from typing import Any

import requests

try:
    from . import dingtalk_oapi
except ImportError:
    import dingtalk_oapi  # type: ignore[no-redef]


DEFAULT_CONFLICT_STRATEGY = "AUTO_RENAME"
SUPPLIER_CACHE_FILE_NAME = "supplier-cache.xlsx"


def _config_value(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"未配置 {name}，无法上传合同到钉盘")
    return value


def _conflict_strategy() -> str:
    raw = (os.getenv("DINGTALK_DRIVE_CONFLICT_POLICY") or DEFAULT_CONFLICT_STRATEGY).strip()
    mapping = {
        "autoRename": "AUTO_RENAME",
        "AUTO_RENAME": "AUTO_RENAME",
        "overwrite": "OVERWRITE",
        "OVERWRITE": "OVERWRITE",
        "returnExisting": "RETURN_DENTRY_IF_EXISTS",
        "RETURN_DENTRY_IF_EXISTS": "RETURN_DENTRY_IF_EXISTS",
        "returnError": "RETURN_ERROR_IF_EXISTS",
        "RETURN_ERROR_IF_EXISTS": "RETURN_ERROR_IF_EXISTS",
    }
    if raw not in mapping:
        raise RuntimeError(f"DINGTALK_DRIVE_CONFLICT_POLICY 不支持：{raw}")
    return mapping[raw]


def _union_id(current_user: dict[str, Any] | None) -> str:
    user = current_user or {}
    value = str(user.get("unionid") or user.get("unionId") or "").strip()
    if not value:
        raise RuntimeError("当前用户缺少 unionId，无法上传合同到钉盘")
    return value


def _operator_id(current_user: dict[str, Any] | None) -> str:
    user = current_user or {}
    value = str(user.get("userid") or user.get("userId") or "").strip()
    if not value:
        raise RuntimeError("当前用户缺少 userid，无法搜索钉盘文件")
    return value


def _storage_client() -> Any:
    try:
        from alibabacloud_dingtalk.storage_2_0.client import Client as DingtalkStorageClient
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk，无法调用钉盘存储 API") from exc

    config = open_api_models.Config()
    config.protocol = "https"
    config.region_id = "central"
    return DingtalkStorageClient(config)


def _download_client() -> Any:
    try:
        from alibabacloud_dingtalk.storage_1_0.client import Client as DingtalkStorageClient
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk，无法调用钉盘下载 API") from exc

    config = open_api_models.Config()
    config.protocol = "https"
    config.region_id = "central"
    return DingtalkStorageClient(config)


def _models() -> Any:
    try:
        from alibabacloud_dingtalk.storage_2_0 import models as storage_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk，无法构造钉盘存储请求") from exc
    return storage_models


def _download_models() -> Any:
    try:
        from alibabacloud_dingtalk.storage_1_0 import models as storage_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_dingtalk，无法构造钉盘下载请求") from exc
    return storage_models


def _runtime_options() -> Any:
    try:
        from alibabacloud_tea_util import models as util_models
    except ImportError as exc:
        raise RuntimeError("未安装 alibabacloud_tea_util，无法调用钉盘存储 API") from exc
    return util_models.RuntimeOptions()


def _to_map(value: Any) -> Any:
    if hasattr(value, "to_map"):
        return value.to_map()
    if hasattr(value, "__dict__"):
        return {key: _to_map(item) for key, item in vars(value).items() if not key.startswith("_")}
    if isinstance(value, dict):
        return {key: _to_map(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_to_map(item) for item in value]
    return value


def _get_value(data: Any, *names: str) -> Any:
    if isinstance(data, dict):
        for name in names:
            if name in data:
                return data[name]
    for name in names:
        if hasattr(data, name):
            return getattr(data, name)
    return None


def _response_body(response: Any) -> Any:
    return _get_value(response, "body") or response


def _upload_with_header_signature(path: Path, upload_info: Any) -> None:
    header_signature = _get_value(upload_info, "headerSignatureInfo", "header_signature_info")
    resource_urls = _get_value(header_signature, "resourceUrls", "resource_urls")
    headers = _get_value(header_signature, "headers") or {}
    if not resource_urls:
        raise RuntimeError("钉盘未返回 Header 加签上传地址")
    upload_url = resource_urls[0]
    with path.open("rb") as handle:
        response = requests.put(upload_url, data=handle, headers=headers, timeout=120)
    response.raise_for_status()


def upload_file_to_dingdrive(
    path: Path,
    file_name: str,
    current_user: dict[str, Any] | None,
    conflict_strategy: str | None = None,
) -> dict[str, Any]:
    """Upload a local file to the configured DingTalk team folder."""
    parent_dentry_uuid = _config_value("DINGTALK_DRIVE_PARENT_ID")
    configured_space_id = _config_value("DINGTALK_DRIVE_SPACE_ID")
    union_id = _union_id(current_user)
    size = path.stat().st_size
    token = dingtalk_oapi.get_app_access_token()

    client = _storage_client()
    storage_models = _models()
    runtime = _runtime_options()

    upload_headers = storage_models.GetFileUploadInfoHeaders()
    upload_headers.x_acs_dingtalk_access_token = token
    pre_check = storage_models.GetFileUploadInfoRequestOptionPreCheckParam(size=size, name=file_name)
    upload_option = storage_models.GetFileUploadInfoRequestOption(
        storage_driver="DINGTALK",
        pre_check_param=pre_check,
        prefer_intranet=False,
    )
    upload_request = storage_models.GetFileUploadInfoRequest(
        union_id=union_id,
        protocol="HEADER_SIGNATURE",
        option=upload_option,
    )
    upload_response = client.get_file_upload_info_with_options(parent_dentry_uuid, upload_request, upload_headers, runtime)
    upload_body = _response_body(upload_response)
    upload_key = _get_value(upload_body, "uploadKey", "upload_key")
    if not upload_key:
        raise RuntimeError("钉盘未返回 uploadKey，无法提交文件")

    _upload_with_header_signature(path, upload_body)

    commit_headers = storage_models.CommitFileHeaders()
    commit_headers.x_acs_dingtalk_access_token = token
    commit_option = storage_models.CommitFileRequestOption(
        size=size,
        conflict_strategy=conflict_strategy or _conflict_strategy(),
        convert_to_online_doc=False,
    )
    commit_request = storage_models.CommitFileRequest(
        union_id=union_id,
        upload_key=upload_key,
        name=file_name,
        option=commit_option,
    )
    commit_response = client.commit_file_with_options(parent_dentry_uuid, commit_request, commit_headers, runtime)
    commit_body = _to_map(_response_body(commit_response))
    dentry = _get_value(commit_body, "dentry") or commit_body

    file_id = _get_value(dentry, "id", "fileId", "file_id")
    file_path = _get_value(dentry, "path", "filePath", "file_path")
    space_id = _get_value(dentry, "spaceId", "space_id") or configured_space_id
    preview_url = _get_value(dentry, "previewUrl", "preview_url", "openUrl", "open_url", "url")
    open_url = _get_value(dentry, "openUrl", "open_url", "previewUrl", "preview_url", "url")
    return {
        "spaceId": space_id,
        "parentId": parent_dentry_uuid,
        "fileId": file_id,
        "fileName": _get_value(dentry, "name", "fileName", "file_name") or file_name,
        "fileSize": _get_value(dentry, "size", "fileSize", "file_size") or size,
        "fileType": path.suffix.lower().lstrip(".") or (mimetypes.guess_extension(path.name) or "").lstrip("."),
        "filePath": file_path,
        "previewUrl": preview_url,
        "openUrl": open_url,
        "raw": dentry,
    }


def upload_contract_to_dingdrive(path: Path, file_name: str, current_user: dict[str, Any] | None) -> dict[str, Any]:
    """Upload a generated contract to the configured DingTalk team folder."""
    return upload_file_to_dingdrive(path, file_name, current_user)


def upload_supplier_cache_to_dingdrive(path: Path, current_user: dict[str, Any] | None) -> dict[str, Any]:
    """Submit the merged supplier cache using the stable cache file name."""
    return upload_file_to_dingdrive(path, SUPPLIER_CACHE_FILE_NAME, current_user, conflict_strategy="OVERWRITE")


def find_supplier_cache_file(current_user: dict[str, Any] | None) -> dict[str, Any] | None:
    operator_id = _operator_id(current_user)
    token = dingtalk_oapi.get_app_access_token()
    configured_space_id = _config_value("DINGTALK_DRIVE_SPACE_ID")

    storage_models = _models()
    headers = storage_models.SearchDentriesHeaders()
    headers.x_acs_dingtalk_access_token = token
    option_kwargs: dict[str, Any] = {"max_results": 20}
    if configured_space_id.isdigit():
        option_kwargs["space_ids"] = [int(configured_space_id)]
    option = storage_models.SearchDentriesRequestOption(**option_kwargs)
    request = storage_models.SearchDentriesRequest(
        keyword=SUPPLIER_CACHE_FILE_NAME,
        operator_id=operator_id,
        option=option,
    )
    response = _storage_client().search_dentries_with_options(request, headers, _runtime_options())
    body = _to_map(_response_body(response))
    items = body.get("items") if isinstance(body, dict) and isinstance(body.get("items"), list) else []
    exact_matches = [item for item in items if isinstance(item, dict) and item.get("name") == SUPPLIER_CACHE_FILE_NAME]
    if not exact_matches:
        return None
    exact_matches.sort(key=lambda item: item.get("lastModifyTime") or 0, reverse=True)
    item = exact_matches[0]
    return {
        "spaceId": configured_space_id,
        "fileId": item.get("dentryUuid") or item.get("fileId") or item.get("id"),
        "fileName": item.get("name") or SUPPLIER_CACHE_FILE_NAME,
        "raw": item,
    }


def download_supplier_cache_from_dingdrive(target_path: Path, current_user: dict[str, Any] | None) -> dict[str, Any] | None:
    cache_file = find_supplier_cache_file(current_user)
    if not cache_file or not cache_file.get("fileId"):
        return None
    download_info = get_contract_download_info(str(cache_file["spaceId"]), str(cache_file["fileId"]), current_user)
    resource_urls = download_info.get("resourceUrls") if isinstance(download_info, dict) else None
    headers = download_info.get("headers") if isinstance(download_info, dict) else None
    if not resource_urls:
        raise RuntimeError("钉盘未返回供应商缓存下载地址")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(resource_urls[0], headers=headers or {}, stream=True, timeout=120)
    response.raise_for_status()
    with target_path.open("wb") as handle:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                handle.write(chunk)
    cache_file["path"] = target_path
    return cache_file


def get_contract_download_info(space_id: str, file_id: str, current_user: dict[str, Any] | None) -> dict[str, Any]:
    union_id = _union_id(current_user)
    token = dingtalk_oapi.get_app_access_token()
    storage_models = _download_models()

    headers = storage_models.GetFileDownloadInfoHeaders()
    headers.x_acs_dingtalk_access_token = token
    option = storage_models.GetFileDownloadInfoRequestOption(version=1, prefer_intranet=False)
    request = storage_models.GetFileDownloadInfoRequest(union_id=union_id, option=option)
    response = _download_client().get_file_download_info_with_options(space_id, file_id, request, headers, _runtime_options())
    body = _to_map(_response_body(response))
    header_signature = _get_value(body, "headerSignatureInfo", "header_signature_info") or body
    return {
        "resourceUrls": _get_value(header_signature, "resourceUrls", "resource_urls") or [],
        "headers": _get_value(header_signature, "headers") or {},
        "expirationSeconds": _get_value(header_signature, "expirationSeconds", "expiration_seconds"),
        "raw": body,
    }
