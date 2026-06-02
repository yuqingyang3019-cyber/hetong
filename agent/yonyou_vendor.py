from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from typing import Any
from urllib.parse import quote, urlencode

import requests


DATA_CENTER_URL = "https://apigateway.yonyoucloud.com/open-auth/dataCenter/getGatewayAddress"
DEFAULT_YONBIP_GATEWAY_URL = "https://c3.yonyoucloud.com/iuap-api-gateway"
DEFAULT_YONBIP_TOKEN_URL = "https://c3.yonyoucloud.com/iuap-api-gateway"
TOKEN_PATH = "/open-auth/selfAppAuth/getAccessToken"
VENDOR_QUERY_PATH = "/yonbip/digitalModel/vendor/queryByPage"
VENDOR_DETAIL_PATH = "/yonbip/digitalModel/vendor/detail"
DEFAULT_LOOKUP_PAGE_SIZE = 10
EXPLICIT_VENDOR_DATA_FIELDS = ",".join([
    "id",
    "code",
    "name",
    "creditcode",
    "address",
    "contactphone",
    "vendorphone",
    "vendorfax",
    "vendoraddress",
    "orgId",
    "org",
    "accessstatus",
    "freezestatus",
    "pubts",
])
SUPPLIER_FIELD_MAP = {
    "supplierName": "name",
    "supplierAddress": "address",
    "supplierBank": "openaccountbankName",
    "supplierAccount": "bankAccount",
    "supplierTaxNo": "creditcode",
    "supplierPhone": "contactphone",
    "supplierRepresentativeName": "contactName",
    "supplierRepresentativePhone": "contactMobile",
    "supplierRepresentativeEmail": "contactEmail",
}


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


def api_get(url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict):
        raise RuntimeError(f"接口返回不是 JSON 对象：{url}")
    return body


def api_post(url: str, params: dict[str, Any] | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.post(url, params=params, json=payload or {}, timeout=60)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict):
        raise RuntimeError(f"接口返回不是 JSON 对象：{url}")
    return body


def success_code(body: dict[str, Any], expected: str) -> bool:
    return str(body.get("code") or "").strip() == expected


def get_gateway_address(tenant_id: str) -> tuple[str, str]:
    body = api_get(DATA_CENTER_URL, {"tenantId": tenant_id})
    if not success_code(body, "00000"):
        raise RuntimeError(f"获取用友数据中心域名失败：{body.get('message') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    gateway_url = str(data.get("gatewayUrl") or "").rstrip("/")
    token_url = str(data.get("tokenUrl") or "").rstrip("/")
    if not gateway_url or not token_url:
        raise RuntimeError("用友数据中心域名返回缺少 gatewayUrl 或 tokenUrl")
    return gateway_url, token_url


def resolve_endpoints() -> tuple[str, str]:
    gateway_url = optional_env("YONBIP_GATEWAY_URL").rstrip("/") or DEFAULT_YONBIP_GATEWAY_URL
    token_url = optional_env("YONBIP_TOKEN_URL").rstrip("/") or DEFAULT_YONBIP_TOKEN_URL
    if gateway_url and token_url:
        return gateway_url, token_url

    tenant_id = optional_env("YONBIP_TENANT_ID")
    if tenant_id:
        return get_gateway_address(tenant_id)
    if gateway_url:
        return gateway_url, gateway_url
    raise RuntimeError("缺少配置：YONBIP_GATEWAY_URL；或配置 YONBIP_TENANT_ID 自动解析动态域名")


def sign_token_request(app_key: str, app_secret: str, timestamp: int) -> str:
    plain = f"appKey{app_key}timestamp{timestamp}"
    digest = hmac.new(app_secret.encode("utf-8"), plain.encode("utf-8"), hashlib.sha256).digest()
    return quote(base64.b64encode(digest).decode("ascii"), safe="")


def get_access_token(token_url: str) -> tuple[str, int]:
    app_key = require_env("YONBIP_APP_KEY")
    app_secret = require_env("YONBIP_APP_SECRET")
    timestamp = int(time.time() * 1000)
    signature = sign_token_request(app_key, app_secret, timestamp)
    url = f"{token_url}{TOKEN_PATH}?{urlencode({'appKey': app_key, 'timestamp': timestamp})}&signature={signature}"
    body = api_get(url)
    if not success_code(body, "00000"):
        raise RuntimeError(f"获取用友 access_token 失败：{body.get('message') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    token = str(data.get("access_token") or "")
    expire = int(data.get("expire") or 0)
    if not token:
        raise RuntimeError("获取用友 access_token 成功但返回为空")
    return token, expire


def vendor_query_payload(page_index: int, page_size: int) -> dict[str, Any]:
    return {
        "data": EXPLICIT_VENDOR_DATA_FIELDS,
        "page": {
            "pageSize": page_size,
            "pageIndex": page_index,
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
            },
            "vendorcontactss": {
                "data": "*",
            }
        },
    }


def vendor_lookup_payload(supplier_name: str, page_index: int = 1, page_size: int = DEFAULT_LOOKUP_PAGE_SIZE) -> dict[str, Any]:
    payload = vendor_query_payload(page_index, page_size)
    payload["condition"] = {
        "simpleVOs": [
            {
                "field": "name",
                "op": "eq",
                "value1": supplier_name,
            }
        ]
    }
    return payload


def query_supplier_by_name(supplier_name: str, page_size: int = DEFAULT_LOOKUP_PAGE_SIZE) -> dict[str, Any]:
    name = as_text(supplier_name)
    if not name:
        return {"recordCount": 0, "records": [], "reason": "missing_supplier_name"}
    gateway_url, token_url = resolve_endpoints()
    access_token, _expire = get_access_token(token_url)
    body = api_post(
        f"{gateway_url}{VENDOR_QUERY_PATH}",
        {"access_token": access_token},
        vendor_lookup_payload(name, page_size=page_size),
    )
    if not success_code(body, "200"):
        raise RuntimeError(f"用友供应商抬头查询失败：{body.get('message') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    records = data.get("recordList") if isinstance(data.get("recordList"), list) else []
    return {
        "recordCount": int(data.get("recordCount") or 0),
        "pageIndex": int(data.get("pageIndex") or 1),
        "pageSize": int(data.get("pageSize") or page_size),
        "pageCount": int(data.get("pageCount") or 0),
        "records": [record for record in records if isinstance(record, dict)],
    }


def query_supplier_detail(record: dict[str, Any]) -> dict[str, Any]:
    vendor_id = as_text(record.get("id"))
    if not vendor_id:
        return {}
    gateway_url, token_url = resolve_endpoints()
    access_token, _expire = get_access_token(token_url)
    params: dict[str, Any] = {"access_token": access_token, "id": vendor_id}
    org_id = as_text(record.get("orgId") or record.get("org"))
    if org_id:
        params["orgId"] = org_id
    body = api_get(f"{gateway_url}{VENDOR_DETAIL_PATH}", params)
    if not success_code(body, "200"):
        raise RuntimeError(f"用友供应商详情查询失败：{body.get('message') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    return data


def vendor_is_available(record: dict[str, Any]) -> bool:
    freeze_status = record.get("freezestatus")
    is_frozen = freeze_status is True or str(freeze_status) == "1"
    is_stopped = record.get("stop") is True or record.get("stopstatus") is True
    return not is_frozen and not is_stopped


def choose_bank(banks: Any) -> dict[str, Any]:
    rows = [bank for bank in banks if isinstance(bank, dict)] if isinstance(banks, list) else []
    active = [bank for bank in rows if bank.get("stopstatus") is not True]
    for bank in active:
        if bank.get("defaultbank") is True:
            return bank
    return active[0] if active else {}


def openaccountbank_name(bank: dict[str, Any]) -> str:
    value = as_text(bank.get("openaccountbank_name"))
    if value:
        return value
    nested = bank.get("openaccountbank")
    return as_text(nested) if isinstance(nested, dict) else ""


def choose_contact(contacts: Any) -> dict[str, Any]:
    rows = [contact for contact in contacts if isinstance(contact, dict)] if isinstance(contacts, list) else []
    for contact in rows:
        if contact.get("defaultcontact") is True:
            return contact
    return rows[0] if rows else {}


def vendor_cache_row(record: dict[str, Any]) -> dict[str, Any]:
    bank = choose_bank(record.get("vendorbanks"))
    contact = choose_contact(record.get("vendorcontactss"))
    return {
        "id": as_text(record.get("id")),
        "code": as_text(record.get("code")),
        "name": as_text(record.get("name")),
        "creditcode": as_text(record.get("creditcode")),
        "address": as_text(record.get("address") or record.get("vendoraddress")),
        "contactphone": as_text(record.get("contactphone") or record.get("vendorphone")),
        "openaccountbankName": openaccountbank_name(bank),
        "bankAccount": as_text(bank.get("account")),
        "bankAccountName": as_text(bank.get("accountname")),
        "contactName": as_text(contact.get("contactname") or contact.get("name")),
        "contactMobile": as_text(contact.get("contactmobile") or contact.get("mobile") or contact.get("phone")),
        "contactEmail": as_text(contact.get("contactemail") or contact.get("email")),
        "vendorFax": as_text(record.get("vendorfax")),
        "org": as_text(record.get("orgId") or record.get("org")),
        "orgName": as_text(record.get("org_name") or record.get("orgName")),
        "accessstatus": as_text(record.get("accessstatus")),
        "freezestatus": record.get("freezestatus"),
        "pubts": as_text(record.get("pubts")),
    }


def supplier_patch_from_yonbip(extracted: dict[str, Any], page_size: int = DEFAULT_LOOKUP_PAGE_SIZE) -> dict[str, Any]:
    supplier_name = as_text(extracted.get("supplierName"))
    if not supplier_name:
        return {"source": "yonbip", "matched": False, "patch": {}, "reason": "missing_supplier_name"}

    lookup = query_supplier_by_name(supplier_name, page_size=page_size)
    records = lookup.get("records") if isinstance(lookup.get("records"), list) else []
    available_records = [record for record in records if vendor_is_available(record)]
    if not available_records:
        return {
            "source": "yonbip",
            "matched": False,
            "patch": {},
            "reason": "not_found",
            "supplierName": supplier_name,
            "recordCount": lookup.get("recordCount", 0),
        }
    if len(available_records) > 1:
        return {
            "source": "yonbip",
            "matched": False,
            "patch": {},
            "reason": "ambiguous",
            "supplierName": supplier_name,
            "recordCount": lookup.get("recordCount", len(available_records)),
            "candidateCount": len(available_records),
        }

    selected = available_records[0]
    if not selected.get("vendorcontactss"):
        try:
            detail = query_supplier_detail(selected)
            selected = {**selected, **detail}
        except Exception:
            pass
    row = vendor_cache_row(selected)
    patch: dict[str, str] = {}
    missing_fields: list[str] = []
    for field_key, row_key in SUPPLIER_FIELD_MAP.items():
        value = as_text(row.get(row_key))
        if value:
            patch[field_key] = value
        else:
            missing_fields.append(field_key)
    return {
        "source": "yonbip",
        "matched": True,
        "supplierName": supplier_name,
        "yonbipSupplierName": row.get("name"),
        "yonbipSupplierCode": row.get("code"),
        "patch": patch,
        "patchedFields": sorted(patch),
        "missingYonbipFields": sorted(missing_fields),
    }


def apply_yonbip_supplier_patch(extracted: dict[str, Any], patch: dict[str, Any]) -> set[str]:
    changed: set[str] = set()
    values = patch.get("patch") if isinstance(patch.get("patch"), dict) else {}
    for key, value in values.items():
        text = as_text(value)
        if not text:
            continue
        if as_text(extracted.get(key)) != text:
            extracted[key] = text
            changed.add(key)
    return changed
