from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import requests
import sys
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, AsyncGenerator, Optional
from urllib.parse import quote

try:
    from zoneinfo import ZoneInfo
except ModuleNotFoundError:
    ZoneInfo = None  # type: ignore[assignment]

from fastapi import Body, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

try:
    from .contract.config import (
        DRAFTS_DIR,
        UPLOADS_DIR,
        ensure_storage,
        get_template_config,
        safe_file_name,
    )
    from .contract.extract import extract_text_from_file, parser_metadata_for_file
    from .contract.llm import extract_template_render_data, is_timeout_error
    from .contract.render import merge_render_data, render_contract
except ImportError:
    from contract.config import (
        DRAFTS_DIR,
        UPLOADS_DIR,
        ensure_storage,
        get_template_config,
        safe_file_name,
    )
    from contract.extract import extract_text_from_file, parser_metadata_for_file
    from contract.llm import extract_template_render_data, is_timeout_error
    from contract.render import merge_render_data, render_contract

try:
    from .dingdrive import get_contract_download_info, upload_contract_to_dingdrive, upload_file_to_dingdrive
    from .storage_cleanup import remove_contract_files, remove_upload
    from .yonyou_vendor import sync_suppliers_to_xlsx
except ImportError:
    from dingdrive import get_contract_download_info  # type: ignore[no-redef]
    from dingdrive import upload_contract_to_dingdrive  # type: ignore[no-redef]
    from dingdrive import upload_file_to_dingdrive  # type: ignore[no-redef]
    from storage_cleanup import remove_contract_files, remove_upload  # type: ignore[no-redef]
    from yonyou_vendor import sync_suppliers_to_xlsx  # type: ignore[no-redef]


app = FastAPI(title="合同生成 Agent")

_allowed_origins = [o.strip() for o in (os.getenv("AGENT_ALLOWED_ORIGINS") or "").split(",") if o.strip()]
_origin_regex = (os.getenv("AGENT_ALLOWED_ORIGIN_REGEX") or "").strip()
if _allowed_origins or _origin_regex:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins if _allowed_origins else [],
        allow_origin_regex=_origin_regex or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )


def error_payload(code: str, message: str, detail: Any = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": False, "code": code, "message": message}
    if detail is not None and detail != message:
        payload["detail"] = detail
    return payload


def api_error(status_code: int, code: str, message: str, detail: Any = None) -> HTTPException:
    payload: dict[str, Any] = {"code": code, "message": message}
    if detail is not None and detail != message:
        payload["detail"] = detail
    return HTTPException(status_code=status_code, detail=payload)


@app.exception_handler(HTTPException)
async def json_http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict):
        code = str(detail.get("code") or "HTTP_ERROR")
        message = str(detail.get("message") or detail.get("detail") or "请求失败")
        extra = detail.get("detail")
    else:
        code = "HTTP_ERROR"
        message = str(detail or "请求失败")
        extra = None
    return JSONResponse(error_payload(code, message, extra), status_code=exc.status_code, headers=exc.headers)


def error_code_message(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            return str(detail.get("code") or "HTTP_ERROR"), str(detail.get("message") or "请求失败")
        return "HTTP_ERROR", str(detail or "请求失败")
    text = str(exc)
    if "OCR" in text or "图片" in text:
        return "OCR_FAILED", "图片识别失败，请检查图片清晰度后重试"
    if "DashScope" in text or "百炼" in text or "DASHSCOPE" in text:
        return "LLM_FAILED", "字段识别失败，请检查报价单文本或补充说明后重试"
    if "钉盘" in text or "DINGTALK_DRIVE" in text:
        return "DINGDRIVE_UPLOAD_FAILED", "合同上传钉盘失败，请稍后重试"
    return "CONTRACT_GENERATE_FAILED", "合同生成失败，请根据原因调整字段后重试"

AGENT_TOKEN_TYPE = "agent"


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    if pad != 4:
        s += "=" * pad
    return base64.urlsafe_b64decode(s.encode("ascii"))


def session_signing_secret() -> str:
    return (os.getenv("APP_SESSION_SECRET") or "").strip()


def sign_session_payload(payload: dict[str, Any]) -> str:
    secret = session_signing_secret()
    if not secret:
        raise RuntimeError("未配置 APP_SESSION_SECRET，无法签发登录态")
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body_b64 = _b64url_encode(body)
    sig = hmac.new(secret.encode("utf-8"), body_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body_b64}.{sig}"


def verify_signed_payload(raw: str, expected_type: str | None = None) -> dict[str, Any] | None:
    secret = session_signing_secret()
    if not secret or "." not in raw:
        return None
    body_b64, sig = raw.rsplit(".", 1)
    expected = hmac.new(secret.encode("utf-8"), body_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        payload = json.loads(_b64url_decode(body_b64))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if expected_type and payload.get("typ") != expected_type:
        return None
    try:
        exp = float(payload.get("exp") or 0)
    except (TypeError, ValueError):
        return None
    if time.time() > exp:
        return None
    return payload


def get_current_user(request: Request) -> dict[str, Any]:
    if not session_signing_secret():
        raise HTTPException(status_code=500, detail={"code": "AUTH_CONFIG_MISSING", "message": "未配置 APP_SESSION_SECRET，无法校验访问凭证"})
    auth = request.headers.get("authorization") or ""
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail={"code": "AUTH_REQUIRED", "message": "缺少 AgentRun 访问凭证"})
    payload = verify_signed_payload(token.strip(), AGENT_TOKEN_TYPE)
    if not payload:
        raise HTTPException(status_code=401, detail={"code": "AGENT_TOKEN_EXPIRED", "message": "AgentRun 访问凭证无效或已过期"})
    return payload


agentrun_logger = logging.getLogger("agentrun")
if not agentrun_logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s [agentrun] %(levelname)s %(message)s"))
    agentrun_logger.addHandler(handler)
agentrun_logger.setLevel(logging.INFO)
agentrun_logger.propagate = False


def elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def log_meta(**meta: Any) -> str:
    clean = {key: value for key, value in meta.items() if value is not None}
    if not clean:
        return ""
    try:
        return " " + json.dumps(clean, ensure_ascii=False, default=str)
    except Exception:
        return " [meta_unserializable]"


def log_info(message: str, **meta: Any) -> None:
    agentrun_logger.info("%s%s", message, log_meta(**meta))


def log_warning(message: str, **meta: Any) -> None:
    agentrun_logger.warning("%s%s", message, log_meta(**meta))


def log_exception(message: str, exc: Exception, **meta: Any) -> None:
    agentrun_logger.exception("%s%s", message, log_meta(error=str(exc), **meta))


def new_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"


def contract_file_name(render_data: dict[str, Any], generated_at: datetime | None = None) -> str:
    supplier = str(render_data.get("supplierName") or "未知乙方").strip() or "未知乙方"
    timestamp = (generated_at or datetime.now()).strftime("%Y%m%d_%H%M%S")
    return f"{timestamp}_{safe_file_name(supplier)}.docx"


def sse_event(event: dict[str, Any]) -> bytes:
    payload = {"timestamp": int(time.time() * 1000), **event}
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def contract_download_payload(draft: dict[str, Any]) -> dict[str, Any]:
    contract_id = draft["contractId"]
    ding_drive = draft.get("dingDrive") if isinstance(draft.get("dingDrive"), dict) else None
    if not ding_drive:
        raise RuntimeError("合同未返回钉盘文件信息")
    file_name = ding_drive.get("fileName") or draft.get("fileName") or f"{contract_id}.docx"
    preview_url = str(ding_drive.get("previewUrl") or ding_drive.get("openUrl") or "").strip()
    open_url = str(ding_drive.get("openUrl") or ding_drive.get("previewUrl") or "").strip()
    payload = {
        "contractId": contract_id,
        "fileName": file_name,
        "dingDrive": ding_drive,
        "preview": {
            "type": "dingtalk_drive",
            "previewUrl": preview_url,
            "openUrl": open_url,
            "downloadProvidedByPreview": True,
        },
        "download": {
            "type": "agent_proxy",
            "fileName": file_name,
            "savePathHint": "文件将保存到浏览器或钉钉客户端的默认下载目录；如系统弹窗提示，请选择目标保存位置。",
        },
    }
    if open_url:
        payload["openUrl"] = open_url
    if preview_url:
        payload["previewUrl"] = preview_url
    if ding_drive.get("filePath"):
        payload["filePath"] = ding_drive["filePath"]
    if ding_drive.get("fileSize"):
        payload["fileSize"] = ding_drive["fileSize"]
    if ding_drive.get("fileType"):
        payload["fileType"] = ding_drive["fileType"]
    return payload


SUPPORTED_QUOTE_EXTENSIONS = {
    ".xlsx",
    ".xls",
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".webp",
}
SUPPORTED_QUOTE_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/bmp",
    "image/gif",
    "image/tiff",
    "image/webp",
}
QUOTE_FILE_SIGNATURE_ERROR = "文件内容与格式不匹配，请重新上传 PDF、Excel 或常见图片格式报价单"
QUOTE_IMAGE_KINDS = {"jpeg", "png", "bmp", "gif", "tiff", "webp"}
QUOTE_FILE_KIND_BY_EXTENSION = {
    ".xlsx": "xlsx",
    ".xls": "xls",
    ".pdf": "pdf",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".png": "png",
    ".bmp": "bmp",
    ".gif": "gif",
    ".tif": "tiff",
    ".tiff": "tiff",
    ".webp": "webp",
}
QUOTE_FILE_KIND_BY_MIME = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "application/pdf": "pdf",
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/tiff": "tiff",
    "image/webp": "webp",
}
QUOTE_MIME_BY_KIND = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
    "pdf": "application/pdf",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "bmp": "image/bmp",
    "gif": "image/gif",
    "tiff": "image/tiff",
    "webp": "image/webp",
}


def _normalized_mime_type(mime_type: str) -> str:
    return (mime_type or "").split(";", 1)[0].strip().lower()


def _quote_file_kind(original_name: str, mime_type: str) -> str | None:
    suffix = Path(original_name).suffix.lower()
    normalized_mime = _normalized_mime_type(mime_type)
    if suffix in QUOTE_FILE_KIND_BY_EXTENSION:
        return QUOTE_FILE_KIND_BY_EXTENSION[suffix]
    if normalized_mime in QUOTE_FILE_KIND_BY_MIME:
        return QUOTE_FILE_KIND_BY_MIME[normalized_mime]
    return None


def _quote_file_kind_from_content(content: bytes) -> str | None:
    signatures = (
        ("xlsx", (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")),
        ("xls", (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",)),
        ("pdf", (b"%PDF",)),
        ("jpeg", (b"\xff\xd8\xff",)),
        ("png", (b"\x89PNG\r\n\x1a\n",)),
        ("bmp", (b"BM",)),
        ("gif", (b"GIF87a", b"GIF89a")),
        ("tiff", (b"II*\x00", b"MM\x00*")),
    )
    for kind, expected in signatures:
        if content.startswith(expected):
            return kind
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "webp"
    return None


def validate_quote_file_signature(content: bytes, original_name: str, mime_type: str) -> str:
    declared_kind = _quote_file_kind(original_name, mime_type)
    content_kind = _quote_file_kind_from_content(content)
    if declared_kind is None or content_kind is None:
        raise api_error(400, "INVALID_ARGUMENT", QUOTE_FILE_SIGNATURE_ERROR)
    if declared_kind != content_kind and not (declared_kind in QUOTE_IMAGE_KINDS and content_kind in QUOTE_IMAGE_KINDS):
        raise api_error(400, "INVALID_ARGUMENT", QUOTE_FILE_SIGNATURE_ERROR)
    return QUOTE_MIME_BY_KIND[content_kind]


def _user_resource_owner(current_user: dict[str, Any] | None) -> dict[str, str]:
    user = current_user or {}
    userid = str(user.get("userid") or "").strip()
    unionid = str(user.get("unionid") or user.get("unionId") or "").strip()
    return {"ownerUserid": userid, "ownerUnionid": unionid}


def _same_upload_owner(upload: dict[str, Any], current_user: dict[str, Any] | None) -> bool:
    owner = _user_resource_owner(current_user)
    return bool(
        owner["ownerUserid"]
        and owner["ownerUnionid"]
        and upload.get("ownerUserid") == owner["ownerUserid"]
        and upload.get("ownerUnionid") == owner["ownerUnionid"]
    )


def public_upload_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["id"],
        "originalName": record["originalName"],
        "fileName": record["fileName"],
        "mimeType": record["mimeType"],
        "size": record["size"],
    }


def validate_supported_quote_file(original_name: str, mime_type: str) -> None:
    suffix = Path(original_name).suffix.lower()
    normalized_mime = _normalized_mime_type(mime_type)
    if suffix in SUPPORTED_QUOTE_EXTENSIONS:
        return
    if normalized_mime in SUPPORTED_QUOTE_MIME_TYPES:
        return
    raise api_error(400, "UNSUPPORTED_FILE_TYPE", "当前版本支持 PDF、Excel 或图片报价单")


def save_upload_bytes(content: bytes, original_name: str, mime_type: str, current_user: dict[str, Any]) -> dict[str, Any]:
    ensure_storage()
    upload_id = new_id("upload")
    file_name = f"{upload_id}_{safe_file_name(original_name)}"
    path = UPLOADS_DIR / file_name
    path.write_bytes(content)
    record = {
        "id": upload_id,
        "fileName": file_name,
        "originalName": original_name,
        "mimeType": mime_type or "application/octet-stream",
        "size": len(content),
        "path": str(path),
        **_user_resource_owner(current_user),
    }
    (UPLOADS_DIR / f"{upload_id}.json").write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    log_info(
        "upload persisted",
        uploadId=upload_id,
        fileName=file_name,
        originalName=original_name,
        mimeType=record["mimeType"],
        size=record["size"],
    )
    return record


def load_upload(upload_id: str, current_user: dict[str, Any] | None = None) -> dict[str, Any]:
    record_path = UPLOADS_DIR / f"{upload_id}.json"
    if not record_path.exists():
        raise api_error(404, "NOT_FOUND", "上传文件不存在")
    upload = json.loads(record_path.read_text(encoding="utf-8"))
    if current_user is not None and not _same_upload_owner(upload, current_user):
        raise api_error(403, "FORBIDDEN", "无权访问该上传文件")
    return upload


def parse_data_source(value: str, fallback_mime_type: str) -> tuple[bytes, str]:
    prefix = "base64,"
    if value.startswith("data:") and prefix in value:
        metadata, encoded = value.split(prefix, 1)
        mime_type = metadata.removeprefix("data:").removesuffix(";")
        return base64.b64decode(encoded), mime_type or fallback_mime_type
    return base64.b64decode(value), fallback_mime_type


async def read_upload_payload(request: Request, file: UploadFile | None) -> tuple[bytes, str, str, int | None, str]:
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise api_error(400, "INVALID_ARGUMENT", "上传请求体格式不正确")
        original_name = str(payload.get("originalName") or payload.get("fileName") or "quote.bin")
        mime_type = str(payload.get("mimeType") or "application/octet-stream")
        data = payload.get("data") or payload.get("contentBase64")
        if not isinstance(data, str) or not data:
            raise api_error(400, "INVALID_ARGUMENT", "上传请求缺少文件内容")
        try:
            content, parsed_mime = parse_data_source(data, mime_type)
        except Exception as exc:
            raise api_error(400, "INVALID_ARGUMENT", "上传文件内容不是合法 base64") from exc
        declared_size = payload.get("size")
        return content, original_name, parsed_mime, declared_size if isinstance(declared_size, int) else None, "json-base64"

    if file is None:
        raise api_error(400, "INVALID_ARGUMENT", "请上传报价单文件")
    content = await file.read()
    return content, file.filename or "quote.bin", file.content_type or "application/octet-stream", None, "multipart"


def last_user_message(input_data: dict[str, Any]) -> dict[str, Any] | None:
    messages = input_data.get("messages") or []
    for message in reversed(messages):
        if message.get("role") == "user":
            return message
    return None


def summarize_agui_input(input_data: dict[str, Any]) -> dict[str, Any]:
    messages = input_data.get("messages") if isinstance(input_data.get("messages"), list) else []
    message = last_user_message(input_data)
    content = message.get("content") if message else None
    forwarded = input_data.get("forwardedProps") if isinstance(input_data.get("forwardedProps"), dict) else {}
    state = input_data.get("state") if isinstance(input_data.get("state"), dict) else {}
    return {
        "threadId": input_data.get("threadId"),
        "runId": input_data.get("runId"),
        "messageCount": len(messages),
        "contentKind": "multimodal" if isinstance(content, list) else type(content).__name__,
        "contentTypes": [part.get("type") for part in content if isinstance(part, dict)] if isinstance(content, list) else None,
        "forwardedPropKeys": sorted(forwarded.keys()),
        "stateKeys": sorted(state.keys()),
    }


def table_row_counts(data: dict[str, Any]) -> dict[str, int]:
    return {key: len(value) for key, value in data.items() if isinstance(value, list)}


def _decimal_from_field(value: Any) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    cleaned = (
        text.replace(",", "")
        .replace("，", "")
        .replace("￥", "")
        .replace("¥", "")
        .replace("元", "")
        .replace("%", "")
        .strip()
    )
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def _tax_rate_from_field(value: Any) -> Decimal | None:
    raw = _decimal_from_field(value)
    if raw is None:
        return None
    if raw.copy_abs() > 1:
        return raw / Decimal("100")
    return raw


def _format_money(value: Decimal) -> str:
    rounded = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return format(rounded.normalize(), "f")


def apply_tax_calculations(extracted: dict[str, Any], config: Any) -> set[str]:
    scalar_keys = set(getattr(config, "scalar_keys", []))
    required = {"taxRate", "totalAmount", "amountWithoutTax", "taxAmount"}
    if not required <= scalar_keys:
        return set()
    rate = _tax_rate_from_field(extracted.get("taxRate"))
    if rate is None:
        extracted["taxRate"] = "13"
        rate = Decimal("0.13")
    if rate < 0:
        return set()

    total = _decimal_from_field(extracted.get("totalAmount"))
    amount_without_tax = _decimal_from_field(extracted.get("amountWithoutTax"))
    tax_amount = _decimal_from_field(extracted.get("taxAmount"))
    changed: set[str] = set()

    if total is not None and amount_without_tax is None:
        amount_without_tax = total / (Decimal("1") + rate)
        extracted["amountWithoutTax"] = _format_money(amount_without_tax)
        changed.add("amountWithoutTax")
    if amount_without_tax is not None and tax_amount is None:
        tax_amount = amount_without_tax * rate
        extracted["taxAmount"] = _format_money(tax_amount)
        changed.add("taxAmount")
    if total is None and amount_without_tax is not None:
        total = amount_without_tax * (Decimal("1") + rate)
        extracted["totalAmount"] = _format_money(total)
        changed.add("totalAmount")
    if amount_without_tax is None and tax_amount is not None and rate != 0:
        amount_without_tax = tax_amount / rate
        extracted["amountWithoutTax"] = _format_money(amount_without_tax)
        extracted["totalAmount"] = _format_money(amount_without_tax + tax_amount)
        changed.update({"amountWithoutTax", "totalAmount"})

    return changed


def _positive_int_from_field(value: Any) -> int | None:
    normalized = str(value).replace("天", "").replace("日", "") if value is not None else value
    number = _decimal_from_field(normalized)
    if number is None:
        return None
    if number <= 0 or number != number.to_integral_value():
        return None
    return int(number)


def _today_shanghai() -> date:
    if ZoneInfo is None:
        return (datetime.utcnow() + timedelta(hours=8)).date()
    return datetime.now(ZoneInfo("Asia/Shanghai")).date()


def apply_delivery_date_calculation(extracted: dict[str, Any], config: Any, today: date | None = None, overwrite: bool = False) -> set[str]:
    scalar_keys = set(getattr(config, "scalar_keys", []))
    required = {"deliveryDays", "deliveryYear", "deliveryMonth", "deliveryDay"}
    if not required <= scalar_keys:
        return set()
    delivery_days = _positive_int_from_field(extracted.get("deliveryDays"))
    if delivery_days is None:
        return set()
    target = (today or _today_shanghai()) + timedelta(days=delivery_days)
    values = {
        "deliveryYear": f"{target.year}",
        "deliveryMonth": f"{target.month:02d}",
        "deliveryDay": f"{target.day:02d}",
    }
    changed: set[str] = set()
    for key, value in values.items():
        if not overwrite and not _is_blank_field(extracted.get(key)):
            continue
        if extracted.get(key) != value:
            extracted[key] = value
            changed.add(key)
    return changed


def _get_by_dot_path(data: dict[str, Any], key: str) -> Any:
    if key in data:
        return data.get(key)
    current: Any = data
    for part in key.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _is_blank_field(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    if isinstance(value, dict):
        return all(_is_blank_field(item) for item in value.values())
    return False


def _field_display_value(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def classify_extracted_fields(extracted: dict[str, Any], config: Any) -> dict[str, Any]:
    recognized_fields: list[dict[str, Any]] = []
    missing_fields: list[dict[str, Any]] = []
    scalar_labels = {field["key"]: field.get("label") or field["key"] for field in config.schema.get("scalars", [])}

    for key in config.scalar_keys:
        value = _get_by_dot_path(extracted, key)
        item = {"type": "scalar", "key": key, "label": scalar_labels.get(key, key)}
        if _is_blank_field(value):
            missing_fields.append(item)
        else:
            recognized_fields.append({**item, "value": _field_display_value(value)})

    for table_name, columns in config.table_bindings.items():
        table_def = config.schema.get("tables", {}).get(table_name, {})
        table_label = table_def.get("label") or table_name
        column_labels = {column["key"]: column.get("label") or column["key"] for column in table_def.get("columns", [])}
        rows_value = extracted.get(table_name)
        rows = rows_value if isinstance(rows_value, list) else []
        if not rows:
            missing_fields.append({"type": "table", "key": table_name, "label": table_label, "reason": "未识别到明细行"})
            continue

        display_rows: list[list[dict[str, str]]] = []
        for row_index, row in enumerate(rows):
            source = row if isinstance(row, dict) else {}
            display_row: list[dict[str, str]] = []
            for column in columns:
                value = source.get(column)
                label = column_labels.get(column, column)
                if _is_blank_field(value):
                    missing_fields.append({
                        "type": "tableCell",
                        "key": f"{table_name}.{row_index}.{column}",
                        "label": f"{table_label} 第 {row_index + 1} 行 {label}",
                    })
                else:
                    display_row.append({"key": column, "label": label, "value": _field_display_value(value)})
            display_rows.append(display_row)

        recognized_fields.append({
            "type": "table",
            "key": table_name,
            "label": table_label,
            "rowCount": len(rows),
            "rows": display_rows,
        })

    return {
        "recognizedFields": recognized_fields,
        "missingFields": missing_fields,
        "tableRowCounts": table_row_counts(extracted),
    }


def extract_agui_attachment(input_data: dict[str, Any], current_user: dict[str, Any]) -> dict[str, Any] | None:
    message = last_user_message(input_data)
    content = message.get("content") if message else None
    if not isinstance(content, list):
        return None
    for part in content:
        if not isinstance(part, dict) or part.get("type") not in {"document", "image"}:
            continue
        source = part.get("source")
        if not isinstance(source, dict):
            continue
        metadata = part.get("metadata") if isinstance(part.get("metadata"), dict) else {}
        source_type = source.get("type")
        mime_type = source.get("mimeType") or "application/octet-stream"
        file_name = metadata.get("fileName") or metadata.get("filename") or metadata.get("name") or f"quote{mimetypes.guess_extension(mime_type) or '.bin'}"
        log_info("agui attachment detected", sourceType=source_type, fileName=file_name, mimeType=mime_type)
        if source_type == "data":
            parse_start = time.perf_counter()
            content_bytes, parsed_mime = parse_data_source(source.get("value", ""), mime_type)
            validate_supported_quote_file(file_name, parsed_mime)
            if not content_bytes:
                raise api_error(400, "INVALID_ARGUMENT", "上传文件为空，请重新选择报价单文件")
            parsed_mime = validate_quote_file_signature(content_bytes, file_name, parsed_mime)
            log_info(
                "agui attachment decoded",
                fileName=file_name,
                mimeType=parsed_mime,
                size=len(content_bytes),
                elapsedMs=elapsed_ms(parse_start),
            )
            return save_upload_bytes(content_bytes, file_name, parsed_mime, current_user)
    return None


def extract_quote_text(upload_id: str, current_user: dict[str, Any]) -> tuple[dict[str, Any], str, dict[str, Any]]:
    upload = load_upload(upload_id, current_user)
    extract_start = time.perf_counter()
    quote_text = extract_text_from_file(Path(upload["path"]), upload.get("mimeType", ""))
    parser = parser_metadata_for_file(Path(upload["path"]), upload.get("mimeType", ""))
    log_info(
        "quote text extracted",
        uploadId=upload_id,
        fileName=upload.get("fileName"),
        parser=parser.get("type"),
        ocrUsed=parser.get("ocrUsed"),
        quoteTextLength=len(quote_text),
        elapsedMs=elapsed_ms(extract_start),
    )
    return upload, quote_text, parser


def generate_contract(
    upload_id: str,
    template_type: str,
    quote_text: str | None = None,
    extra_info: str | None = None,
    extracted_data: dict[str, Any] | None = None,
    current_user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    start = time.perf_counter()
    has_confirmed_text = bool(quote_text and quote_text.strip())
    has_confirmed_data = isinstance(extracted_data, dict)
    log_info(
        "contract generation start",
        uploadId=upload_id,
        templateType=template_type,
        confirmedQuoteText=has_confirmed_text,
        confirmedExtractedData=has_confirmed_data,
    )
    try:
        upload = load_upload(upload_id, current_user)
        log_info(
            "contract upload loaded",
            uploadId=upload_id,
            fileName=upload.get("fileName"),
            originalName=upload.get("originalName"),
            mimeType=upload.get("mimeType"),
            size=upload.get("size"),
        )

        try:
            config = get_template_config(template_type)
        except ValueError as exc:
            raise api_error(400, "INVALID_ARGUMENT", str(exc)) from exc
        log_info("contract template loaded", uploadId=upload_id, templateType=config.type)

        if has_confirmed_text:
            quote_text = quote_text.strip()
            log_info(
                "quote text confirmed by user",
                uploadId=upload_id,
                fileName=upload.get("fileName"),
                quoteTextLength=len(quote_text),
            )
        else:
            upload, quote_text, _parser = extract_quote_text(upload_id, current_user)

        if has_confirmed_data:
            extracted = extracted_data or {}
            log_info(
                "confirmed extracted data accepted",
                uploadId=upload_id,
                templateType=config.type,
                tableRowCounts=table_row_counts(extracted),
            )
        else:
            llm_start = time.perf_counter()
            log_info(
                "llm extraction start",
                uploadId=upload_id,
                templateType=config.type,
                quoteTextLength=len(quote_text),
                extraInfoLength=len((extra_info or "").strip()),
            )
            extracted = extract_template_render_data(quote_text, config, extra_info)
            log_info(
                "llm extraction finished",
                uploadId=upload_id,
                templateType=config.type,
                tableRowCounts=table_row_counts(extracted),
                elapsedMs=elapsed_ms(llm_start),
            )

        computed_tax_fields = apply_tax_calculations(extracted, config)
        if computed_tax_fields:
            log_info(
                "tax fields calculated",
                uploadId=upload_id,
                templateType=config.type,
                fields=sorted(computed_tax_fields),
            )
        computed_delivery_fields = apply_delivery_date_calculation(extracted, config)
        if computed_delivery_fields:
            log_info(
                "delivery date calculated",
                uploadId=upload_id,
                templateType=config.type,
                fields=sorted(computed_delivery_fields),
            )
        render_data = merge_render_data(extracted, config)
        contract_id = new_id("contract")
        file_name = contract_file_name(render_data)
        contract_stem = Path(file_name).stem

        render_start = time.perf_counter()
        log_info("contract render start", uploadId=upload_id, contractId=contract_id, fileName=file_name, templateType=config.type)
        contract_path = render_contract(render_data, config, contract_stem, blank_missing=has_confirmed_data)
        log_info(
            "contract render finished",
            uploadId=upload_id,
            contractId=contract_id,
            outputFile=contract_path.name,
            elapsedMs=elapsed_ms(render_start),
        )

        upload_start = time.perf_counter()
        ding_drive = upload_contract_to_dingdrive(contract_path, file_name, current_user)
        log_info(
            "contract uploaded to dingdrive",
            uploadId=upload_id,
            contractId=contract_id,
            fileName=file_name,
            dingDriveFileId=ding_drive.get("fileId"),
            dingDrivePath=ding_drive.get("filePath"),
            elapsedMs=elapsed_ms(upload_start),
        )

        draft = {
            "upload": upload,
            "templateType": config.type,
            "quoteTextLength": len(quote_text),
            "extraInfoLength": len((extra_info or "").strip()),
            "extractedData": extracted,
            "renderData": render_data,
            "contractId": contract_id,
            "fileName": file_name,
            "contractPath": str(contract_path),
            "dingDrive": ding_drive,
        }
        (DRAFTS_DIR / f"{contract_id}.json").write_text(json.dumps(draft, ensure_ascii=False), encoding="utf-8")
        removed_paths = remove_upload(upload)
        removed_paths.extend(remove_contract_files(contract_id, contract_path))
        log_info(
            "contract generation finished",
            uploadId=upload_id,
            contractId=contract_id,
            fileName=file_name,
            templateType=config.type,
            processFilesRemoved=len(removed_paths),
            elapsedMs=elapsed_ms(start),
        )
        return draft
    except Exception as exc:
        log_exception("contract generation failed", exc, uploadId=upload_id, templateType=template_type, elapsedMs=elapsed_ms(start))
        raise


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/uploads")
async def upload_file(
    request: Request,
    current_user: dict = Depends(get_current_user),
    file: Optional[UploadFile] = File(None),
) -> dict:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    content_type = request.headers.get("content-type", "")
    log_info(
        "upload request start",
        clientHost=client_host,
        contentType=content_type,
        dingtalkUserId=current_user.get("userid"),
    )
    original_name = ""
    try:
        content, original_name, mime_type, declared_size, uploadMode = await read_upload_payload(request, file)
        validate_supported_quote_file(original_name, mime_type)
        log_info(
            "upload bytes read",
            originalName=original_name,
            mimeType=mime_type,
            size=len(content),
            declaredSize=declared_size,
            uploadMode=uploadMode,
        )
        if not content:
            log_warning(
                "upload request rejected empty file",
                clientHost=client_host,
                originalName=original_name,
                mimeType=mime_type,
                declaredSize=declared_size,
                uploadMode=uploadMode,
                elapsedMs=elapsed_ms(start),
            )
            raise api_error(400, "INVALID_ARGUMENT", "上传文件为空，请重新选择报价单文件")
        mime_type = validate_quote_file_signature(content, original_name, mime_type)
        if declared_size is not None and declared_size != len(content):
            log_warning(
                "upload size mismatch",
                clientHost=client_host,
                originalName=original_name,
                declaredSize=declared_size,
                decodedSize=len(content),
                uploadMode=uploadMode,
            )
        record = save_upload_bytes(content, original_name, mime_type, current_user)
        log_info(
            "upload request finished",
            clientHost=client_host,
            uploadId=record["id"],
            fileName=record["fileName"],
            uploadMode=uploadMode,
            elapsedMs=elapsed_ms(start),
        )
        return {"ok": True, **public_upload_record(record)}
    except HTTPException:
        raise
    except Exception as exc:
        log_exception("upload request failed", exc, clientHost=client_host, originalName=original_name, elapsedMs=elapsed_ms(start))
        raise api_error(500, "INTERNAL_ERROR", "上传失败，请稍后重试", str(exc)) from exc


@app.post("/api/uploads/{upload_id}/quote-text")
async def parse_quote_text_api(
    upload_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
) -> dict:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    template_type = "caigouhetong"
    if "application/json" in request.headers.get("content-type", ""):
        payload = await request.json()
        if isinstance(payload, dict) and payload.get("templateType"):
            template_type = str(payload["templateType"])
    log_info(
        "quote text api request start",
        clientHost=client_host,
        uploadId=upload_id,
        templateType=template_type,
        dingtalkUserId=current_user.get("userid"),
    )
    try:
        config = get_template_config(template_type)
        upload, quote_text, parser = extract_quote_text(upload_id, current_user)
    except HTTPException:
        raise
    except ValueError as exc:
        if "图片" in str(exc) or "OCR" in str(exc):
            raise api_error(502, "OCR_FAILED", "图片识别失败，请检查图片清晰度后重试", str(exc)) from exc
        raise api_error(400, "INVALID_ARGUMENT", str(exc)) from exc
    except Exception as exc:
        log_exception("quote text extraction failed", exc, uploadId=upload_id, templateType=template_type, elapsedMs=elapsed_ms(start))
        raise api_error(500, "INTERNAL_ERROR", "解析报价单失败，请检查文件后重试", str(exc)) from exc
    response = {
        "ok": True,
        "uploadId": upload_id,
        "originalName": upload.get("originalName"),
        "fileName": upload.get("fileName"),
        "mimeType": upload.get("mimeType"),
        "templateType": config.type,
        "quoteText": quote_text,
        "textLength": len(quote_text),
        "parser": parser,
    }
    log_info(
        "quote text api request finished",
        clientHost=client_host,
        uploadId=upload_id,
        templateType=config.type,
        quoteTextLength=len(quote_text),
        elapsedMs=elapsed_ms(start),
    )
    return response


@app.post("/api/uploads/{upload_id}/field-preview")
async def preview_quote_fields_api(
    upload_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
) -> dict:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    payload = await request.json()
    if not isinstance(payload, dict):
        raise api_error(400, "INVALID_ARGUMENT", "字段识别请求体格式不正确")

    template_type = str(payload.get("templateType") or "caigouhetong")
    quote_text_value = payload.get("quoteText")
    extra_info_value = payload.get("extraInfo")
    quote_text = quote_text_value.strip() if isinstance(quote_text_value, str) and quote_text_value.strip() else None
    extra_info = extra_info_value.strip() if isinstance(extra_info_value, str) and extra_info_value.strip() else None

    log_info(
        "field preview request start",
        clientHost=client_host,
        uploadId=upload_id,
        templateType=template_type,
        quoteTextProvided=bool(quote_text),
        quoteTextLength=len(quote_text or ""),
        extraInfoLength=len(extra_info or ""),
        dingtalkUserId=current_user.get("userid"),
    )
    try:
        context_start = time.perf_counter()
        log_info(
            "field preview stage",
            stage="load_context_start",
            uploadId=upload_id,
            templateType=template_type,
        )
        config = get_template_config(template_type)
        upload = load_upload(upload_id, current_user)
        log_info(
            "field preview stage",
            stage="context_loaded",
            uploadId=upload_id,
            templateType=config.type,
            templateName=config.display_name,
            fileName=upload.get("fileName"),
            originalName=upload.get("originalName"),
            mimeType=upload.get("mimeType"),
            size=upload.get("size"),
            quoteTextSource="request" if quote_text else "upload_extract",
            elapsedMs=elapsed_ms(context_start),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise api_error(400, "INVALID_ARGUMENT", str(exc)) from exc
    if not quote_text:
        try:
            extract_start = time.perf_counter()
            log_info(
                "field preview stage",
                stage="quote_extract_start",
                uploadId=upload_id,
                templateType=config.type,
                fileName=upload.get("fileName"),
            )
            upload, quote_text, _parser = extract_quote_text(upload_id, current_user)
            log_info(
                "field preview stage",
                stage="quote_extract_finished",
                uploadId=upload_id,
                templateType=config.type,
                parser=_parser,
                quoteTextLength=len(quote_text),
                elapsedMs=elapsed_ms(extract_start),
            )
        except HTTPException:
            raise
        except ValueError as exc:
            if "图片" in str(exc) or "OCR" in str(exc):
                raise api_error(502, "OCR_FAILED", "图片识别失败，请检查图片清晰度后重试", str(exc)) from exc
            raise api_error(400, "INVALID_ARGUMENT", str(exc)) from exc
        except Exception as exc:
            log_exception("field preview quote extraction failed", exc, uploadId=upload_id, templateType=template_type, elapsedMs=elapsed_ms(start))
            raise api_error(500, "INTERNAL_ERROR", "解析报价单失败，请检查文件后重试", str(exc)) from exc

    llm_start = time.perf_counter()
    try:
        log_info(
            "field preview stage",
            stage="llm_start",
            uploadId=upload_id,
            templateType=config.type,
            quoteTextLength=len(quote_text),
            extraInfoLength=len(extra_info or ""),
            scalarCount=len(config.scalar_keys),
            tableCount=len(config.table_bindings),
        )
        extracted = extract_template_render_data(quote_text, config, extra_info)
        computed_tax_fields = apply_tax_calculations(extracted, config)
        computed_delivery_fields = apply_delivery_date_calculation(extracted, config)
        log_info(
            "field preview stage",
            stage="llm_finished",
            uploadId=upload_id,
            templateType=config.type,
            tableRowCounts=table_row_counts(extracted),
            computedTaxFields=sorted(computed_tax_fields),
            computedDeliveryFields=sorted(computed_delivery_fields),
            elapsedMs=elapsed_ms(llm_start),
        )
    except Exception as exc:
        log_exception("field preview llm failed", exc, uploadId=upload_id, templateType=config.type, elapsedMs=elapsed_ms(llm_start))
        if is_timeout_error(exc):
            raise api_error(
                502,
                "LLM_FAILED",
                "字段识别超时，请稍后重试；如报价单内容较长，可先删减无关文本后再识别",
            ) from exc
        raise api_error(502, "LLM_FAILED", "字段识别失败，请检查报价单文本或补充说明后重试", str(exc)) from exc
    classify_start = time.perf_counter()
    log_info(
        "field preview stage",
        stage="classify_start",
        uploadId=upload_id,
        templateType=config.type,
    )
    field_summary = classify_extracted_fields(extracted, config)
    log_info(
        "field preview stage",
        stage="classify_finished",
        uploadId=upload_id,
        templateType=config.type,
        recognizedCount=len(field_summary["recognizedFields"]),
        missingCount=len(field_summary["missingFields"]),
        elapsedMs=elapsed_ms(classify_start),
    )
    log_info(
        "field preview request finished",
        clientHost=client_host,
        uploadId=upload_id,
        templateType=config.type,
        quoteTextLength=len(quote_text),
        extraInfoLength=len(extra_info or ""),
        recognizedCount=len(field_summary["recognizedFields"]),
        missingCount=len(field_summary["missingFields"]),
        llmElapsedMs=elapsed_ms(llm_start),
        elapsedMs=elapsed_ms(start),
    )

    return {
        "ok": True,
        "uploadId": upload_id,
        "originalName": upload.get("originalName"),
        "templateType": config.type,
        "templateName": config.display_name,
        "quoteTextLength": len(quote_text),
        "extraInfoLength": len(extra_info or ""),
        "extractedData": extracted,
        **field_summary,
    }


@app.post("/api/suppliers/sync")
def sync_suppliers_api(current_user: dict = Depends(get_current_user)) -> dict:
    start = time.perf_counter()
    cache_path: Path | None = None
    try:
        log_info("supplier sync start", dingtalkUserId=current_user.get("userid"))
        sync_result = sync_suppliers_to_xlsx(DRAFTS_DIR)
        cache_path = sync_result["path"]
        file_name = str(sync_result["fileName"])
        ding_drive = upload_file_to_dingdrive(cache_path, file_name, current_user)
        log_info(
            "supplier sync finished",
            fileName=file_name,
            sourceRecordCount=sync_result.get("sourceRecordCount"),
            uniqueVendorCount=sync_result.get("uniqueVendorCount"),
            elapsedMs=elapsed_ms(start),
        )
        return {
            "ok": True,
            "fileName": file_name,
            "sourceApi": sync_result.get("sourceApi"),
            "sourceRecordCount": sync_result.get("sourceRecordCount"),
            "fetchedRecordCount": sync_result.get("fetchedRecordCount"),
            "availableRecordCount": sync_result.get("availableRecordCount"),
            "uniqueVendorCount": sync_result.get("uniqueVendorCount"),
            "pageSize": sync_result.get("pageSize"),
            "syncedAt": sync_result.get("syncedAt"),
            "dingDrive": ding_drive,
            "download": {
                "type": "agent_proxy",
                "fileName": file_name,
                "savePathHint": "文件将保存到浏览器或钉钉客户端的默认下载目录；如系统弹窗提示，请选择目标保存位置。",
            },
        }
    except HTTPException:
        raise
    except requests.RequestException as exc:
        log_exception("supplier sync request failed", exc, elapsedMs=elapsed_ms(start))
        if cache_path is not None:
            raise api_error(502, "DINGDRIVE_UPLOAD_FAILED", "供应商缓存文件上传钉盘失败，请稍后重试", str(exc)) from exc
        raise api_error(502, "YONBIP_VENDOR_LIST_FAILED", "用友供应商分页查询失败，请稍后重试", str(exc)) from exc
    except RuntimeError as exc:
        message = str(exc)
        log_exception("supplier sync failed", exc, elapsedMs=elapsed_ms(start))
        if "access_token" in message or "YONBIP_APP" in message or "用友数据中心" in message:
            raise api_error(502, "YONBIP_AUTH_FAILED", "用友访问凭证获取失败，请检查 YonBIP 配置", message) from exc
        if "供应商分页查询" in message:
            raise api_error(502, "YONBIP_VENDOR_LIST_FAILED", "用友供应商分页查询失败，请稍后重试", message) from exc
        raise api_error(500, "SUPPLIER_SYNC_FAILED", "供应商同步失败，请稍后重试", message) from exc
    except Exception as exc:
        log_exception("supplier sync unexpected failed", exc, elapsedMs=elapsed_ms(start))
        raise api_error(500, "SUPPLIER_SYNC_FAILED", "供应商同步失败，请稍后重试", str(exc)) from exc
    finally:
        if cache_path and cache_path.exists():
            try:
                cache_path.unlink()
            except Exception as exc:
                log_warning("supplier cache cleanup failed", filePath=str(cache_path), error=str(exc))


@app.post("/api/dingdrive/download")
def download_dingdrive_contract(payload: dict = Body(...), current_user: dict = Depends(get_current_user)) -> StreamingResponse:
    if not isinstance(payload, dict):
        raise api_error(400, "INVALID_ARGUMENT", "下载请求体格式不正确")
    space_id = str(payload.get("spaceId") or "").strip()
    file_id = str(payload.get("fileId") or "").strip()
    file_name = safe_file_name(str(payload.get("fileName") or "contract.docx").strip() or "contract.docx")
    if not space_id or not file_id:
        raise api_error(400, "INVALID_ARGUMENT", "缺少钉盘 spaceId 或 fileId")

    try:
        download_info = get_contract_download_info(space_id, file_id, current_user)
        resource_urls = download_info.get("resourceUrls") if isinstance(download_info, dict) else None
        headers = download_info.get("headers") if isinstance(download_info, dict) else None
        if not resource_urls:
            raise api_error(502, "DINGDRIVE_DOWNLOAD_FAILED", "钉盘未返回合同下载地址")
        response = requests.get(resource_urls[0], headers=headers or {}, stream=True, timeout=120)
        response.raise_for_status()
    except HTTPException:
        raise
    except requests.RequestException as exc:
        raise api_error(502, "DINGDRIVE_DOWNLOAD_FAILED", "下载钉盘合同失败，请稍后重试", str(exc)) from exc
    except RuntimeError as exc:
        raise api_error(502, "DINGDRIVE_DOWNLOAD_FAILED", "获取钉盘合同下载信息失败", str(exc)) from exc

    def iter_content() -> Any:
        try:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    yield chunk
        finally:
            response.close()

    encoded_name = quote(file_name)
    return StreamingResponse(
        iter_content(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"},
    )


async def agui_stream(input_data: dict[str, Any], request: Request, current_user: dict[str, Any]) -> AsyncGenerator[bytes, None]:
    start = time.perf_counter()
    thread_id = input_data.get("threadId") or new_id("thread")
    run_id = input_data.get("runId") or new_id("run")
    message_id = new_id("msg")
    run_summary = summarize_agui_input(input_data)
    run_summary.update({
        "threadId": thread_id,
        "runId": run_id,
        "messageId": message_id,
        "dingtalkUserId": current_user.get("userid"),
    })
    log_info("agui run start", **run_summary)
    yield sse_event({"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id})
    yield sse_event({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": "assistant"})
    try:
        forwarded = input_data.get("forwardedProps") if isinstance(input_data.get("forwardedProps"), dict) else {}
        state = input_data.get("state") if isinstance(input_data.get("state"), dict) else {}
        upload_id = forwarded.get("uploadId") or state.get("uploadId")
        template_type = forwarded.get("templateType") or state.get("templateType") or "caigouhetong"
        quote_text_value = forwarded.get("quoteText") or state.get("quoteText")
        quote_text = quote_text_value.strip() if isinstance(quote_text_value, str) and quote_text_value.strip() else None
        extra_info_value = forwarded.get("extraInfo") or state.get("extraInfo")
        extra_info = extra_info_value.strip() if isinstance(extra_info_value, str) and extra_info_value.strip() else None
        extracted_data_value = forwarded.get("extractedData") or state.get("extractedData")
        extracted_data = extracted_data_value if isinstance(extracted_data_value, dict) else None
        log_info(
            "agui run context resolved",
            threadId=thread_id,
            runId=run_id,
            uploadId=upload_id,
            templateType=template_type,
            confirmedQuoteText=bool(quote_text),
            extraInfoLength=len(extra_info or ""),
            confirmedExtractedData=bool(extracted_data),
        )
        if not upload_id:
            log_info("agui attachment lookup start", threadId=thread_id, runId=run_id)
            attachment = extract_agui_attachment(input_data, current_user)
            if attachment:
                upload_id = attachment["id"]
                log_info(
                    "agui attachment saved",
                    threadId=thread_id,
                    runId=run_id,
                    uploadId=upload_id,
                    originalName=attachment["originalName"],
                    size=attachment["size"],
                )
                yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": f"已收到附件：{attachment['originalName']}\n"})
            else:
                log_warning("agui run missing upload", threadId=thread_id, runId=run_id)
                raise api_error(400, "INVALID_ARGUMENT", "未收到报价单文件，请先在 H5 页面上传报价单")

        if quote_text:
            yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "已确认报价单文本。\n"})
        else:
            yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "正在解析报价单...\n"})
        if extracted_data:
            yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "已确认字段识别结果。\n"})
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "正在生成合同...\n"})
        log_info(
            "agui contract generation dispatch",
            threadId=thread_id,
            runId=run_id,
            uploadId=upload_id,
            templateType=template_type,
            confirmedQuoteText=bool(quote_text),
            extraInfoLength=len(extra_info or ""),
            confirmedExtractedData=bool(extracted_data),
        )
        draft = await asyncio.to_thread(generate_contract, upload_id, template_type, quote_text, extra_info, extracted_data, current_user)
        download_payload = contract_download_payload(draft)
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": "合同已生成并已存入钉盘。"})
        yield sse_event({"type": "CUSTOM", "name": "contract_generated", "value": download_payload})
        yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
        yield sse_event({
            "type": "RUN_FINISHED",
            "threadId": thread_id,
            "runId": run_id,
            "result": {
                "contractId": download_payload["contractId"],
                "preview": download_payload.get("preview"),
                "openUrl": download_payload.get("openUrl"),
                "dingDrive": download_payload.get("dingDrive"),
            },
        })
        log_info(
            "agui run finished",
            threadId=thread_id,
            runId=run_id,
            uploadId=upload_id,
            contractId=draft["contractId"],
            elapsedMs=elapsed_ms(start),
        )
    except Exception as exc:
        code, message = error_code_message(exc)
        log_exception("agui run failed", exc, threadId=thread_id, runId=run_id, code=code, elapsedMs=elapsed_ms(start))
        yield sse_event({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": f"处理失败：{message}"})
        yield sse_event({"type": "TEXT_MESSAGE_END", "messageId": message_id})
        yield sse_event({"type": "RUN_ERROR", "code": code, "message": message})


@app.post("/ag-ui/agent")
async def agui_agent(request: Request) -> StreamingResponse:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    try:
        input_data = await request.json()
    except Exception as exc:
        log_exception("agui request json parse failed", exc, clientHost=client_host, elapsedMs=elapsed_ms(start))
        raise
    current_user = get_current_user(request)
    log_info(
        "agui request received",
        clientHost=client_host,
        dingtalkUserId=current_user.get("userid"),
        elapsedMs=elapsed_ms(start),
        **summarize_agui_input(input_data),
    )
    return StreamingResponse(agui_stream(input_data, request, current_user), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "9000")))
