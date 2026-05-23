#!/usr/bin/env python3
"""Resolve DingDrive space and folder IDs for deployment secrets.

This is a one-off operator script. It prints the values needed by GitHub
Secrets:

    DINGTALK_DRIVE_SPACE_ID
    DINGTALK_DRIVE_PARENT_ID

The script intentionally avoids guessing a folder. If the current DingTalk SDK
does not expose the required directory APIs in the installed version, it prints
the available SDK methods so the operator can provide the target IDs explicitly.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any


def die(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def required_env(name: str) -> str:
    value = env(name)
    if not value:
        die(f"缺少环境变量 {name}")
    return value


def to_map(value: Any) -> Any:
    if hasattr(value, "to_map"):
        return value.to_map()
    if hasattr(value, "__dict__"):
        return {key: to_map(item) for key, item in vars(value).items() if not key.startswith("_")}
    if isinstance(value, dict):
        return {key: to_map(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_map(item) for item in value]
    return value


def get_value(data: Any, *names: str) -> Any:
    if isinstance(data, dict):
        for name in names:
            if name in data:
                return data[name]
    for name in names:
        if hasattr(data, name):
            return getattr(data, name)
    return None


def response_body(response: Any) -> Any:
    return get_value(response, "body") or response


def get_access_token(corp_id: str | None = None) -> str:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    agent_dir = os.path.join(repo_root, "agent")
    if agent_dir not in sys.path:
        sys.path.insert(0, agent_dir)
    import dingtalk_oapi  # type: ignore[import-not-found]

    return dingtalk_oapi.get_app_access_token(corp_id)


def storage_client() -> Any:
    try:
        from alibabacloud_dingtalk.storage_2_0.client import Client
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        die(
            "未安装钉盘 SDK。请先运行：\n"
            "  python3 -m pip install -r agent/requirements.txt\n"
            f"原始错误：{exc}"
        )

    config = open_api_models.Config()
    config.protocol = "https"
    config.region_id = "central"
    return Client(config)


def storage_models() -> Any:
    try:
        from alibabacloud_dingtalk.storage_2_0 import models
    except ImportError as exc:
        die(f"未安装钉盘 SDK models：{exc}")
    return models


def runtime_options() -> Any:
    try:
        from alibabacloud_tea_util import models as util_models
    except ImportError as exc:
        die(f"未安装 alibabacloud_tea_util：{exc}")
    return util_models.RuntimeOptions()


def public_methods(obj: Any) -> list[str]:
    return sorted(name for name in dir(obj) if not name.startswith("_") and callable(getattr(obj, name, None)))


def build_headers(models: Any, access_token: str, class_name: str) -> Any:
    header_cls = getattr(models, class_name, None)
    if header_cls is None:
        return None
    headers = header_cls()
    headers.x_acs_dingtalk_access_token = access_token
    return headers


def find_method(client: Any, *candidates: str) -> str | None:
    available = set(public_methods(client))
    for name in candidates:
        if name in available:
            return name
    return None


def extract_dentry(data: Any) -> dict[str, Any]:
    mapped = to_map(response_body(data))
    if not isinstance(mapped, dict):
        return {}
    dentry = get_value(mapped, "dentry", "Dentry") or mapped
    return dentry if isinstance(dentry, dict) else {}


def list_spaces(client: Any, models: Any, access_token: str, union_id: str) -> list[dict[str, Any]]:
    method_name = find_method(
        client,
        "list_spaces_with_options",
        "list_all_spaces_with_options",
        "list_space_with_options",
    )
    if not method_name:
        return []

    request_cls = getattr(models, "ListSpacesRequest", None) or getattr(models, "ListAllSpacesRequest", None)
    headers = build_headers(models, access_token, "ListSpacesHeaders") or build_headers(models, access_token, "ListAllSpacesHeaders")
    if request_cls is None or headers is None:
        return []

    request = request_cls()
    if hasattr(request, "union_id"):
        request.union_id = union_id
    response = getattr(client, method_name)(request, headers, runtime_options())
    mapped = to_map(response_body(response))
    spaces = get_value(mapped, "spaces", "spaceList", "items", "list") or []
    return spaces if isinstance(spaces, list) else []


def list_children(client: Any, models: Any, access_token: str, union_id: str, space_id: str, parent_id: str) -> list[dict[str, Any]]:
    method_name = find_method(
        client,
        "list_dentries_with_options",
        "list_dentry_with_options",
        "list_files_with_options",
        "list_children_with_options",
    )
    if not method_name:
        return []

    request_cls = (
        getattr(models, "ListDentriesRequest", None)
        or getattr(models, "ListDentryRequest", None)
        or getattr(models, "ListFilesRequest", None)
        or getattr(models, "ListChildrenRequest", None)
    )
    headers = (
        build_headers(models, access_token, "ListDentriesHeaders")
        or build_headers(models, access_token, "ListDentryHeaders")
        or build_headers(models, access_token, "ListFilesHeaders")
        or build_headers(models, access_token, "ListChildrenHeaders")
    )
    if request_cls is None or headers is None:
        return []

    request = request_cls()
    for attr, value in {
        "union_id": union_id,
        "space_id": space_id,
        "parent_id": parent_id,
        "parent_dentry_id": parent_id,
        "parent_dentry_uuid": parent_id,
    }.items():
        if hasattr(request, attr):
            setattr(request, attr, value)
    response = getattr(client, method_name)(request, headers, runtime_options())
    mapped = to_map(response_body(response))
    children = get_value(mapped, "dentries", "files", "items", "list") or []
    return children if isinstance(children, list) else []


def create_folder(client: Any, models: Any, access_token: str, union_id: str, space_id: str, parent_id: str, name: str) -> dict[str, Any]:
    method_name = find_method(
        client,
        "create_folder_with_options",
        "create_dentry_with_options",
        "create_directory_with_options",
    )
    if not method_name:
        return {}

    request_cls = (
        getattr(models, "CreateFolderRequest", None)
        or getattr(models, "CreateDentryRequest", None)
        or getattr(models, "CreateDirectoryRequest", None)
    )
    headers = (
        build_headers(models, access_token, "CreateFolderHeaders")
        or build_headers(models, access_token, "CreateDentryHeaders")
        or build_headers(models, access_token, "CreateDirectoryHeaders")
    )
    if request_cls is None or headers is None:
        return {}

    request = request_cls()
    for attr, value in {
        "union_id": union_id,
        "space_id": space_id,
        "parent_id": parent_id,
        "parent_dentry_id": parent_id,
        "parent_dentry_uuid": parent_id,
        "name": name,
        "type": "folder",
        "dentry_type": "folder",
    }.items():
        if hasattr(request, attr):
            setattr(request, attr, value)
    response = getattr(client, method_name)(request, headers, runtime_options())
    return extract_dentry(response)


def dentry_id(dentry: dict[str, Any]) -> str:
    value = get_value(dentry, "id", "dentryId", "dentry_id", "fileId", "file_id")
    return str(value or "").strip()


def dentry_name(dentry: dict[str, Any]) -> str:
    return str(get_value(dentry, "name", "fileName", "file_name") or "").strip()


def print_result(space_id: str, parent_id: str) -> None:
    print("请将以下值写入 GitHub Secrets：")
    print(f"DINGTALK_DRIVE_SPACE_ID={space_id}")
    print(f"DINGTALK_DRIVE_PARENT_ID={parent_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Resolve DingDrive upload target IDs.")
    parser.add_argument("--space-id", default=env("DINGTALK_DRIVE_SPACE_ID"), help="已知钉盘 spaceId；提供后不再自动查询空间。")
    parser.add_argument("--parent-id", default=env("DINGTALK_DRIVE_PARENT_ID"), help="已知目标目录 ID；同时提供 space-id 时直接输出。")
    parser.add_argument("--target-path", default=env("DINGTALK_DRIVE_TARGET_PATH", "合同生成助手"), help="目标目录路径，使用 / 分隔。")
    parser.add_argument("--root-id", default=env("DINGTALK_DRIVE_ROOT_ID", "root"), help="空间根目录 ID，默认 root。")
    parser.add_argument("--union-id", default=env("DINGTALK_UNION_ID"), help="用于访问钉盘的用户 unionId。")
    parser.add_argument("--create", action="store_true", default=env("DINGTALK_DRIVE_CREATE", "1") not in {"0", "false", "False"}, help="目录不存在时创建。")
    args = parser.parse_args()

    if args.space_id and args.parent_id:
        print_result(args.space_id, args.parent_id)
        return

    union_id = args.union_id or required_env("DINGTALK_UNION_ID")
    access_token = get_access_token(required_env("DINGTALK_CORP_ID"))
    client = storage_client()
    models = storage_models()

    space_id = args.space_id
    if not space_id:
        spaces = list_spaces(client, models, access_token, union_id)
        if len(spaces) == 1:
            space_id = str(get_value(spaces[0], "spaceId", "space_id", "id") or "").strip()
        elif not spaces:
            print("当前 SDK 未暴露可用的空间列表方法，或没有返回空间。", file=sys.stderr)
            print("请在钉盘接口/控制台中先获取 spaceId 后重试：", file=sys.stderr)
            print("  python3 tools/resolve_dingdrive_target.py --space-id <spaceId> --target-path 合同生成助手", file=sys.stderr)
            print("当前 storage_2_0 client 可用方法：", file=sys.stderr)
            print("\n".join(public_methods(client)), file=sys.stderr)
            raise SystemExit(2)
        else:
            print("查询到多个空间，请指定 --space-id：", file=sys.stderr)
            for space in spaces:
                sid = get_value(space, "spaceId", "space_id", "id")
                name = get_value(space, "name", "spaceName", "space_name")
                print(f"  {sid}\t{name}", file=sys.stderr)
            raise SystemExit(2)
    if not space_id:
        die("无法确定 DINGTALK_DRIVE_SPACE_ID")

    current_parent_id = args.root_id
    for segment in [part.strip() for part in args.target_path.split("/") if part.strip()]:
        children = list_children(client, models, access_token, union_id, space_id, current_parent_id)
        matched = next((child for child in children if dentry_name(child) == segment), None)
        if matched:
            current_parent_id = dentry_id(matched)
            continue
        if not args.create:
            die(f"目录不存在：{segment}，当前父目录 ID：{current_parent_id}")
        created = create_folder(client, models, access_token, union_id, space_id, current_parent_id, segment)
        created_id = dentry_id(created)
        if not created_id:
            print("当前 SDK 未暴露可用的目录创建方法，或创建后未返回目录 ID。", file=sys.stderr)
            print("请手动创建目录并提供 --parent-id，或根据以下 SDK 方法补充脚本：", file=sys.stderr)
            print("\n".join(public_methods(client)), file=sys.stderr)
            raise SystemExit(2)
        current_parent_id = created_id

    print_result(space_id, current_parent_id)


if __name__ == "__main__":
    main()
