from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import random
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import requests


DATA_CENTER_URL = "https://apigateway.yonyoucloud.com/open-auth/dataCenter/getGatewayAddress"
DEFAULT_YONBIP_GATEWAY_URL = "https://c3.yonyoucloud.com/iuap-api-gateway"
DEFAULT_YONBIP_TOKEN_URL = "https://c3.yonyoucloud.com/iuap-api-gateway"
TOKEN_PATH = "/open-auth/selfAppAuth/getAccessToken"
VENDOR_QUERY_PATH = "/yonbip/digitalModel/vendor/queryByPage"
VENDOR_LIST_PATH = "/yonbip/digitalModel/vendor/list"
VENDOR_DETAIL_PATH = "/yonbip/digitalModel/vendor/detail"


def load_env_file(path: Path) -> None:
    if not path.exists():
        raise RuntimeError(f"未找到 env 文件：{path}")

    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"缺少配置：{name}")
    return value


def optional_env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        for key in ("zh_CN", "name", "value"):
            nested = value.get(key)
            if nested is not None and str(nested).strip():
                return str(nested).strip()
        for nested in value.values():
            text = as_text(nested)
            if text:
                return text
        return ""
    if isinstance(value, list):
        return " ".join(text for text in (as_text(item) for item in value) if text).strip()
    return str(value).strip()


def is_success_code(value: Any, expected: str) -> bool:
    return str(value or "").strip() == expected


def api_get(url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict):
        raise RuntimeError(f"接口返回不是 JSON 对象：{url}")
    return body


def api_post(url: str, params: dict[str, Any] | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.post(url, params=params, json=payload or {}, timeout=30)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict):
        raise RuntimeError(f"接口返回不是 JSON 对象：{url}")
    return body


def get_gateway_address(tenant_id: str) -> tuple[str, str]:
    body = api_get(DATA_CENTER_URL, {"tenantId": tenant_id})
    if not is_success_code(body.get("code"), "00000"):
        raise RuntimeError(f"获取数据中心域名失败：{body.get('message') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    gateway_url = str(data.get("gatewayUrl") or "").rstrip("/")
    token_url = str(data.get("tokenUrl") or "").rstrip("/")
    if not gateway_url or not token_url:
        raise RuntimeError("数据中心域名返回缺少 gatewayUrl 或 tokenUrl")
    return gateway_url, token_url


def sign_token_request(app_key: str, app_secret: str, timestamp: int) -> str:
    plain = f"appKey{app_key}timestamp{timestamp}"
    digest = hmac.new(app_secret.encode("utf-8"), plain.encode("utf-8"), hashlib.sha256).digest()
    return quote(base64.b64encode(digest).decode("ascii"), safe="")


def get_access_token(token_url: str, app_key: str, app_secret: str) -> tuple[str, int]:
    timestamp = int(time.time() * 1000)
    signature = sign_token_request(app_key, app_secret, timestamp)
    url = f"{token_url}{TOKEN_PATH}?{urlencode({'appKey': app_key, 'timestamp': timestamp})}&signature={signature}"
    body = api_get(url)
    if not is_success_code(body.get("code"), "00000"):
        raise RuntimeError(f"获取 access_token 失败：{body.get('message') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    token = str(data.get("access_token") or "")
    expire = int(data.get("expire") or 0)
    if not token:
        raise RuntimeError("获取 access_token 成功但返回为空")
    return token, expire


def build_query_payload(args: argparse.Namespace, org_id: str) -> dict[str, Any]:
    simple_vos: list[dict[str, Any]] = []
    if args.name:
        simple_vos.append({"field": "name", "op": "eq", "value1": args.name})
    if args.code:
        simple_vos.append({"field": "code", "op": "eq", "value1": args.code})
    if org_id:
        simple_vos.append({"field": "orgId", "op": "eq", "value1": org_id})

    payload: dict[str, Any] = {
        "data": "*",
        "page": {
            "pageIndex": args.page_index,
            "pageSize": args.page_size,
        },
        "queryOrders": [
            {
                "field": "code",
                "order": "asc",
            }
        ],
        "partParam": {
            "vendorbanks": {
                "data": "*,openaccountbank.name",
            }
        },
    }
    if simple_vos:
        payload["condition"] = {"simpleVOs": simple_vos}
    return payload


def records_from_response(body: dict[str, Any]) -> list[dict[str, Any]]:
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    records = data.get("recordList") if isinstance(data.get("recordList"), list) else []
    return [record for record in records if isinstance(record, dict)]


def query_vendors_by_page(gateway_url: str, access_token: str, args: argparse.Namespace, org_id: str) -> list[dict[str, Any]]:
    url = f"{gateway_url}{VENDOR_QUERY_PATH}"
    payload = build_query_payload(args, org_id)
    body = api_post(url, {"access_token": access_token}, payload)
    if not is_success_code(body.get("code"), "200"):
        raise RuntimeError(f"供应商分页查询失败：{body.get('message') or body}")
    return records_from_response(body)


def query_vendors_by_list(gateway_url: str, access_token: str, args: argparse.Namespace, org_id: str) -> list[dict[str, Any]]:
    url = f"{gateway_url}{VENDOR_LIST_PATH}"
    params: dict[str, Any] = {
        "access_token": access_token,
        "pageIndex": args.page_index,
        "pageSize": args.page_size,
    }
    if args.name:
        params["name"] = args.name
    if args.code:
        params["code"] = args.code
    if org_id:
        params["orgId"] = org_id
    body = api_get(url, params)
    if not is_success_code(body.get("code"), "200"):
        raise RuntimeError(f"供应商列表查询失败：{body.get('message') or body}")
    return records_from_response(body)


def query_vendors(gateway_url: str, access_token: str, args: argparse.Namespace, org_id: str) -> list[dict[str, Any]]:
    if args.vendor_api == "queryByPage":
        return query_vendors_by_page(gateway_url, access_token, args, org_id)
    if args.vendor_api == "list":
        return query_vendors_by_list(gateway_url, access_token, args, org_id)
    try:
        return query_vendors_by_page(gateway_url, access_token, args, org_id)
    except Exception as exc:
        print_json("queryByPage 查询失败，尝试 vendor/list", {"error": str(exc)})
        return query_vendors_by_list(gateway_url, access_token, args, org_id)


def vendor_is_available(record: dict[str, Any]) -> bool:
    extends = record.get("vendorextends") if isinstance(record.get("vendorextends"), dict) else {}
    freeze_status = record.get("freezestatus", extends.get("freezestatus"))
    is_frozen = freeze_status is True or str(freeze_status) == "1"
    is_stopped = record.get("stop") is True or record.get("stopstatus") is True
    return not is_frozen and not is_stopped and str(record.get("accessstatus") or "") in {"", "2"}


def normalize_vendor_name(value: Any) -> str:
    return as_text(value).replace(" ", "").replace("\u3000", "")


def summarize_vendor(record: dict[str, Any]) -> dict[str, Any]:
    extends = record.get("vendorextends") if isinstance(record.get("vendorextends"), dict) else {}
    return {
        "code": as_text(record.get("code")),
        "name": as_text(record.get("name")),
        "id": as_text(record.get("id")),
        "orgId": as_text(record.get("orgId") or record.get("org")),
        "applyOrgId": as_text(record.get("vendorApplyRange_org")),
        "applyOrgName": as_text(record.get("vendorApplyRange_org_name")),
        "isApplied": record.get("isApplied"),
        "accessstatus": as_text(record.get("accessstatus")),
        "freezestatus": record.get("freezestatus", extends.get("freezestatus")),
        "stop": record.get("stop"),
        "creditcode": as_text(record.get("creditcode")),
        "address": as_text(record.get("address")),
        "contactphone": as_text(record.get("contactphone")),
    }


def vendor_identity(record: dict[str, Any]) -> str:
    return as_text(record.get("id")) or f"{as_text(record.get('code'))}:{as_text(record.get('name'))}"


def preferred_vendor_record(current: dict[str, Any], candidate: dict[str, Any], org_id: str) -> dict[str, Any]:
    current_score = vendor_preference_score(current, org_id)
    candidate_score = vendor_preference_score(candidate, org_id)
    return candidate if candidate_score > current_score else current


def vendor_preference_score(record: dict[str, Any], org_id: str) -> tuple[int, int, int]:
    apply_org = as_text(record.get("vendorApplyRange_org"))
    return (
        1 if record.get("isApplied") is True else 0,
        1 if org_id and apply_org == org_id else 0,
        1 if apply_org == "666666" else 0,
    )


def unique_vendor_records(records: list[dict[str, Any]], org_id: str) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for record in records:
        key = vendor_identity(record)
        if not key:
            continue
        if key in unique:
            unique[key] = preferred_vendor_record(unique[key], record, org_id)
        else:
            unique[key] = record
    return list(unique.values())


def detail_vendor(gateway_url: str, access_token: str, record: dict[str, Any], default_org_id: str) -> dict[str, Any]:
    vendor_id = str(record.get("id") or "").strip()
    org_id = str(record.get("orgId") or record.get("org") or default_org_id or "").strip()
    if not vendor_id:
        raise RuntimeError("候选供应商缺少 id，无法查询详情")

    params: dict[str, Any] = {"access_token": access_token, "id": vendor_id}
    if org_id:
        params["orgId"] = org_id
    body = api_get(f"{gateway_url}{VENDOR_DETAIL_PATH}", params)
    if not is_success_code(body.get("code"), "200"):
        raise RuntimeError(f"供应商详情查询失败：{body.get('message') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    return data


def choose_bank(banks: Any) -> dict[str, Any]:
    rows = [bank for bank in banks if isinstance(bank, dict)] if isinstance(banks, list) else []
    active = [bank for bank in rows if bank.get("stopstatus") is not True]
    for bank in active:
        if bank.get("defaultbank") is True:
            return bank
    return active[0] if active else {}


def choose_contact(contacts: Any) -> dict[str, Any]:
    rows = [contact for contact in contacts if isinstance(contact, dict)] if isinstance(contacts, list) else []
    for contact in rows:
        if contact.get("defaultcontact") is True:
            return contact
    return rows[0] if rows else {}


def address_from_children(addresses: Any) -> str:
    rows = [item for item in addresses if isinstance(item, dict)] if isinstance(addresses, list) else []
    for row in rows:
        parts = [
            as_text(row.get("province_name") or row.get("province")),
            as_text(row.get("city_name") or row.get("city")),
            as_text(row.get("district_name") or row.get("district")),
            as_text(row.get("address") or row.get("detailAddress") or row.get("vendoraddress")),
        ]
        text = "".join(part for part in parts if part)
        if text:
            return text
    return ""


def map_contract_fields(detail: dict[str, Any]) -> dict[str, str]:
    bank = choose_bank(detail.get("vendorbanks"))
    contact = choose_contact(detail.get("vendorcontactss"))
    return {
        "supplierName": as_text(detail.get("name")),
        "supplierTaxNo": as_text(detail.get("creditcode")),
        "supplierBank": as_text(bank.get("openaccountbank_name")),
        "supplierAccount": as_text(bank.get("account")),
        "supplierAddress": as_text(detail.get("vendoraddress")) or as_text(detail.get("address")) or address_from_children(detail.get("vendorAddresses")),
        "supplierPhone": as_text(detail.get("vendorphone")) or as_text(detail.get("contactphone")) or as_text(contact.get("contactmobile")),
        "supplierFax": as_text(detail.get("vendorfax")),
    }


def resolve_vendor_by_name(
    gateway_url: str,
    access_token: str,
    args: argparse.Namespace,
    org_id: str,
) -> dict[str, Any]:
    vendors = query_vendors(gateway_url, access_token, args, org_id)
    available = [vendor for vendor in vendors if vendor_is_available(vendor)]
    query_name = normalize_vendor_name(args.name)
    matched = available
    if args.exact_name:
        matched = [vendor for vendor in available if normalize_vendor_name(vendor.get("name")) == query_name]
    unique_matched = unique_vendor_records(matched, org_id)

    result: dict[str, Any] = {
        "query": {
            "name": args.name,
            "exactName": args.exact_name,
            "vendorApi": args.vendor_api,
            "pageIndex": args.page_index,
            "pageSize": args.page_size,
        },
        "status": "not_found",
        "totalRecords": len(vendors),
        "availableRecords": len(available),
        "matchedRecords": len(matched),
        "uniqueMatchedRecords": len(unique_matched),
        "candidates": [summarize_vendor(vendor) for vendor in unique_matched],
    }
    if not unique_matched:
        return result
    if len(unique_matched) > 1:
        result["status"] = "multiple_matches"
        return result

    selected = unique_matched[0]
    fields = map_contract_fields(selected)
    detail_status = "list_record"
    if args.fetch_detail:
        detail = detail_vendor(gateway_url, access_token, selected, org_id)
        fields = {**fields, **{key: value for key, value in map_contract_fields(detail).items() if value}}
        detail_status = "detail_record"
    result.update({
        "status": "matched",
        "detailSource": detail_status,
        "selectedVendor": summarize_vendor(selected),
        "fields": fields,
        "filledFields": [key for key, value in fields.items() if value],
        "missingFields": [key for key, value in fields.items() if not value],
    })
    return result


def print_json(title: str, value: Any) -> None:
    print(f"\n{title}")
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="YonBIP 供应商档案只读探针")
    parser.add_argument("--env-file", default=".env.yonbip.local", help="本地 env 文件路径")
    parser.add_argument("--page-index", type=int, default=1, help="供应商分页页码")
    parser.add_argument("--page-size", type=int, default=20, help="供应商分页条数")
    parser.add_argument("--sample-size", type=int, default=5, help="随机抽样详情数量")
    parser.add_argument("--name", default="", help="可选供应商名称过滤")
    parser.add_argument("--exact-name", action="store_true", help="只接受与 --name 完全一致的供应商名称")
    parser.add_argument("--code", default="", help="可选供应商编码过滤")
    parser.add_argument("--vendor-api", choices=("auto", "queryByPage", "list"), default="auto", help="供应商列表接口")
    parser.add_argument("--fetch-detail", action="store_true", help="唯一命中后继续查询详情接口补充银行账号等字段")
    parser.add_argument("--seed", type=int, default=None, help="可选随机种子，方便复现")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_env_file(Path(args.env_file))

    tenant_id = optional_env("YONBIP_TENANT_ID")
    app_key = require_env("YONBIP_APP_KEY")
    app_secret = require_env("YONBIP_APP_SECRET")
    org_id = (os.getenv("YONBIP_ORG_ID") or "").strip()

    gateway_url = optional_env("YONBIP_GATEWAY_URL").rstrip("/") or DEFAULT_YONBIP_GATEWAY_URL
    token_url = optional_env("YONBIP_TOKEN_URL").rstrip("/") or DEFAULT_YONBIP_TOKEN_URL
    if not gateway_url or not token_url:
        if not tenant_id:
            raise RuntimeError("缺少配置：YONBIP_TENANT_ID；或同时配置 YONBIP_GATEWAY_URL 和 YONBIP_TOKEN_URL")
        gateway_url, token_url = get_gateway_address(tenant_id)
    print_json("数据中心域名", {"gatewayUrl": gateway_url, "tokenUrl": token_url})

    access_token, expire = get_access_token(token_url, app_key, app_secret)
    print_json("访问令牌状态", {"ok": True, "expire": expire, "tokenLength": len(access_token)})

    if args.name:
        result = resolve_vendor_by_name(gateway_url, access_token, args, org_id)
        print_json("供应商名称查询与抬头字段映射", result)
        return

    vendors = query_vendors(gateway_url, access_token, args, org_id)
    available = [vendor for vendor in vendors if vendor_is_available(vendor)]
    candidates = [summarize_vendor(item) for item in available]
    print_json("可用供应商候选", candidates)
    if not available:
        raise RuntimeError("未查到可用供应商候选")

    rng = random.Random(args.seed)
    sample_count = min(max(args.sample_size, 1), len(available))
    sample = rng.sample(available, sample_count)

    mapped_results: list[dict[str, Any]] = []
    for record in sample:
        detail = detail_vendor(gateway_url, access_token, record, org_id)
        mapped_results.append({
            "vendor": {
                "code": as_text(record.get("code")),
                "name": as_text(record.get("name")),
                "id": as_text(record.get("id")),
                "orgId": as_text(record.get("orgId") or record.get("org")),
            },
            "fields": map_contract_fields(detail),
        })

    print_json("随机供应商详情字段映射", mapped_results)


if __name__ == "__main__":
    main()
