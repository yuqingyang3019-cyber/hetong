from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import requests
import sys
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

try:
    from zoneinfo import ZoneInfo
except ModuleNotFoundError:
    ZoneInfo = None  # type: ignore[assignment]

from fastapi import Body, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

try:
    from .contract.config import (
        UPLOADS_DIR,
        ensure_storage,
        get_template_config,
        safe_file_name,
    )
    from .contract.extract import extract_excel_payload, extract_text_from_file, parser_metadata_for_file
    from .contract.llm import extract_template_render_data, is_timeout_error, scalar_only_template_config
    from .contract.render import merge_render_data, render_contract
except ImportError:
    from contract.config import (
        UPLOADS_DIR,
        ensure_storage,
        get_template_config,
        safe_file_name,
    )
    from contract.extract import extract_excel_payload, extract_text_from_file, parser_metadata_for_file
    from contract.llm import extract_template_render_data, is_timeout_error, scalar_only_template_config
    from contract.render import merge_render_data, render_contract

try:
    from . import dingtalk_oapi
    from .dingdrive import (
        get_contract_download_info,
        upload_contract_to_dingdrive,
    )
    from .storage_cleanup import remove_contract_files, remove_upload
    from .yonyou_vendor import (
        apply_yonbip_supplier_patch,
        supplier_patch_from_yonbip,
    )
except ImportError:
    import dingtalk_oapi  # type: ignore[no-redef]
    from dingdrive import get_contract_download_info  # type: ignore[no-redef]
    from dingdrive import upload_contract_to_dingdrive  # type: ignore[no-redef]
    from storage_cleanup import remove_contract_files, remove_upload  # type: ignore[no-redef]
    from yonyou_vendor import apply_yonbip_supplier_patch  # type: ignore[no-redef]
    from yonyou_vendor import supplier_patch_from_yonbip  # type: ignore[no-redef]


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
H5_SESSION_TYPE = "h5"
H5_SESSION_COOKIE_NAME = "hetong_h5_session"
BFF_AUTH_PREFIX = "/bff/auth"
STATIC_DIR = Path(os.getenv("H5_STATIC_DIR") or Path(__file__).resolve().parent / "static")


def env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"环境变量 {name} 必须是整数") from exc


def dingtalk_corp_id() -> str:
    return (os.getenv("DINGTALK_CORP_ID") or "").strip()


def dingtalk_client_id() -> str:
    return (os.getenv("DINGTALK_CLIENT_ID") or "").strip()


def agent_token_ttl_seconds() -> int:
    return env_int("AGENT_TOKEN_TTL_SEC", 1800)


def h5_session_ttl_seconds() -> int:
    return env_int("H5_SESSION_TTL_SEC", 7 * 24 * 3600)


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
        raise HTTPException(status_code=401, detail={"code": "AUTH_REQUIRED", "message": "缺少业务访问凭证"})
    payload = verify_signed_payload(token.strip(), AGENT_TOKEN_TYPE)
    if not payload:
        raise HTTPException(status_code=401, detail={"code": "AGENT_TOKEN_EXPIRED", "message": "业务访问凭证无效或已过期"})
    return payload


def public_user_from_session(payload: dict[str, Any]) -> dict[str, Any]:
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


def sign_agent_token(session_payload: dict[str, Any]) -> dict[str, Any]:
    exp = time.time() + agent_token_ttl_seconds()
    token = sign_session_payload({
        "typ": AGENT_TOKEN_TYPE,
        "iss": "hetong-fc",
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
    })
    return {"token": token, "exp": exp}


def set_h5_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=H5_SESSION_COOKIE_NAME,
        value=token,
        max_age=h5_session_ttl_seconds(),
        path="/",
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "").lower() == "true" or os.getenv("NODE_ENV") == "production",
        samesite="lax",
    )


def h5_session_from_request(request: Request) -> dict[str, Any] | None:
    return verify_signed_payload(request.cookies.get(H5_SESSION_COOKIE_NAME, ""), H5_SESSION_TYPE)


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
    timestamp = (generated_at or datetime.now()).strftime("%Y%m%d_%H%M%S")
    contract_no = str(render_data.get("contractNo") or "").strip() or timestamp
    supplier = str(render_data.get("supplierName") or "").strip() or "未知乙方"
    project = str(render_data.get("projectName") or "").strip() or "未知项目"
    return "_".join(safe_file_name(part) for part in (contract_no, supplier, project)) + ".docx"


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


def excel_payload_for_upload(upload: dict[str, Any]) -> dict[str, Any] | None:
    path = Path(upload["path"])
    parser = parser_metadata_for_file(path, upload.get("mimeType", ""))
    if parser.get("type") != "excel":
        return None
    return extract_excel_payload(path)


def attachment_mode_for_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"enabled": False}
    mode = payload.get("attachmentMode")
    return mode if isinstance(mode, dict) else {"enabled": False}


def normalize_table_mode(value: Any) -> str:
    mode = str(value or "auto").strip()
    return mode if mode in {"auto", "template", "attachment"} else "auto"


def selected_attachment_mode(payload: dict[str, Any] | None, table_mode: str = "auto") -> dict[str, Any]:
    normalized_mode = normalize_table_mode(table_mode)
    auto_mode = attachment_mode_for_payload(payload)
    if normalized_mode == "template":
        return {"enabled": False, "tableMode": "template"}
    if normalized_mode == "attachment":
        if not isinstance(payload, dict):
            return {"enabled": False, "tableMode": "attachment", "reason": "not_excel"}
        return {
            **auto_mode,
            "enabled": True,
            "tableMode": "attachment",
            "reasons": sorted(set([*(auto_mode.get("reasons") or []), "user_selected_attachment"])),
        }
    return {**auto_mode, "tableMode": "auto"}


def quote_attachment_for_upload(upload: dict[str, Any], table_mode: str = "auto") -> dict[str, Any] | None:
    payload = excel_payload_for_upload(upload)
    mode = selected_attachment_mode(payload, table_mode)
    if not mode.get("enabled"):
        return None
    return {
        "type": "excel",
        "attachmentMode": mode,
        "sheets": payload.get("sheets") if isinstance(payload, dict) else [],
    }


def extract_quote_text(upload_id: str, current_user: dict[str, Any]) -> tuple[dict[str, Any], str, dict[str, Any]]:
    upload = load_upload(upload_id, current_user)
    extract_start = time.perf_counter()
    parser = parser_metadata_for_file(Path(upload["path"]), upload.get("mimeType", ""))
    excel_payload = excel_payload_for_upload(upload) if parser.get("type") == "excel" else None
    if excel_payload:
        quote_text = str(excel_payload["quoteText"])
        parser = {
            **parser,
            "attachmentMode": attachment_mode_for_payload(excel_payload),
        }
    else:
        quote_text = extract_text_from_file(Path(upload["path"]), upload.get("mimeType", ""))
    log_info(
        "quote text extracted",
        uploadId=upload_id,
        fileName=upload.get("fileName"),
        parser=parser.get("type"),
        ocrUsed=parser.get("ocrUsed"),
        attachmentMode=parser.get("attachmentMode"),
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
    table_mode: str = "auto",
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
        table_mode = normalize_table_mode(table_mode)
        quote_attachment = quote_attachment_for_upload(upload, table_mode)
        if quote_attachment:
            attachment_mode = quote_attachment.get("attachmentMode") if quote_attachment else {"enabled": False}
        else:
            excel_payload = excel_payload_for_upload(upload)
            attachment_mode = selected_attachment_mode(excel_payload, table_mode)
        log_info(
            "contract upload loaded",
            uploadId=upload_id,
            fileName=upload.get("fileName"),
            originalName=upload.get("originalName"),
            mimeType=upload.get("mimeType"),
            size=upload.get("size"),
            attachmentMode=attachment_mode,
            tableMode=table_mode,
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
            llm_config = scalar_only_template_config(config) if attachment_mode.get("enabled") else config
            extracted = extract_template_render_data(quote_text, llm_config, extra_info)
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
        log_info(
            "contract render start",
            uploadId=upload_id,
            contractId=contract_id,
            fileName=file_name,
            templateType=config.type,
        )
        contract_path = render_contract(
            render_data,
            config,
            contract_stem,
            blank_missing=has_confirmed_data,
            quote_attachment=quote_attachment,
            logger=lambda message, **meta: log_info(message, uploadId=upload_id, contractId=contract_id, **meta),
        )
        log_info(
            "contract render finished",
            uploadId=upload_id,
            contractId=contract_id,
            outputFile=contract_path.name,
            attachmentMode=attachment_mode,
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
            "attachmentMode": attachment_mode,
            "tableMode": table_mode,
        }
        cleanup_start = time.perf_counter()
        removed_paths = remove_upload(upload)
        removed_paths.extend(remove_contract_files(contract_path))
        log_info(
            "contract cleanup finished",
            uploadId=upload_id,
            contractId=contract_id,
            removedCount=len(removed_paths),
            removedPaths=[str(path) for path in removed_paths],
            elapsedMs=elapsed_ms(cleanup_start),
        )
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


@app.get(f"{BFF_AUTH_PREFIX}/config")
def bff_auth_config() -> dict[str, Any]:
    return {
        "ok": True,
        "corpId": dingtalk_corp_id() or None,
        "clientId": dingtalk_client_id() or None,
        "agentBaseUrl": "",
        "agentTokenTtlSeconds": agent_token_ttl_seconds(),
        "dingtalkConfigured": dingtalk_oapi.dingtalk_configured(),
    }


@app.get(f"{BFF_AUTH_PREFIX}/me")
def bff_auth_me(request: Request) -> dict[str, Any]:
    session = h5_session_from_request(request)
    if not session:
        return {"ok": True, "loggedIn": False, "user": None}
    return {
        "ok": True,
        "loggedIn": True,
        "user": public_user_from_session(session),
        "agentTokenExpiresAt": session.get("agent_exp"),
    }


@app.post(f"{BFF_AUTH_PREFIX}/agent-token")
def bff_auth_agent_token(request: Request, response: Response) -> dict[str, Any]:
    session = h5_session_from_request(request)
    if not session:
        raise api_error(401, "AUTH_REQUIRED", "登录已失效，请重新进入钉钉应用")
    agent = sign_agent_token(session)
    session["agent_exp"] = agent["exp"]
    set_h5_session_cookie(response, sign_session_payload(session))
    return {
        "ok": True,
        "agentBaseUrl": "",
        "agentAccessToken": agent["token"],
        "expiresAt": agent["exp"],
    }


@app.post(f"{BFF_AUTH_PREFIX}/dingtalk-login")
async def bff_auth_dingtalk_login(request: Request, response: Response) -> dict[str, Any]:
    try:
        payload = await request.json()
    except Exception as exc:
        raise api_error(400, "INVALID_ARGUMENT", "请求体必须是 JSON 对象") from exc
    if not isinstance(payload, dict):
        raise api_error(400, "INVALID_ARGUMENT", "请求体必须是 JSON 对象")
    code = str(payload.get("code") or "").strip()
    corp_id = str(payload.get("corpId") or dingtalk_corp_id() or "").strip()
    if not code:
        raise api_error(400, "INVALID_ARGUMENT", "缺少免登授权码 code")
    if not corp_id:
        raise api_error(400, "INVALID_ARGUMENT", "缺少 corpId")
    try:
        session_payload = dingtalk_oapi.exchange_dingtalk_code(code, corp_id)
    except Exception as exc:
        log_exception("dingtalk login failed", exc, corpId=corp_id, codeLength=len(code))
        raise api_error(502, "DINGTALK_AUTH_FAILED", "钉钉免登失败，请稍后重试或联系管理员", str(exc)) from exc
    session_payload["typ"] = H5_SESSION_TYPE
    session_payload["exp"] = time.time() + h5_session_ttl_seconds()
    agent = sign_agent_token(session_payload)
    session_payload["agent_exp"] = agent["exp"]
    set_h5_session_cookie(response, sign_session_payload(session_payload))
    return {
        "ok": True,
        "user": public_user_from_session(session_payload),
        "agentBaseUrl": "",
        "agentAccessToken": agent["token"],
        "expiresAt": agent["exp"],
    }


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
    table_mode = normalize_table_mode(payload.get("tableMode"))
    quote_text_value = payload.get("quoteText")
    extra_info_value = payload.get("extraInfo")
    quote_text = quote_text_value.strip() if isinstance(quote_text_value, str) and quote_text_value.strip() else None
    extra_info = extra_info_value.strip() if isinstance(extra_info_value, str) and extra_info_value.strip() else None

    log_info(
        "field preview request start",
        clientHost=client_host,
        uploadId=upload_id,
        templateType=template_type,
        tableMode=table_mode,
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
        excel_payload = excel_payload_for_upload(upload)
        attachment_mode = selected_attachment_mode(excel_payload, table_mode)
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
            attachmentMode=attachment_mode,
            tableMode=table_mode,
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
        llm_config = scalar_only_template_config(config) if attachment_mode.get("enabled") else config
        log_info(
            "field preview stage",
            stage="llm_start",
            uploadId=upload_id,
            templateType=config.type,
            quoteTextLength=len(quote_text),
            extraInfoLength=len(extra_info or ""),
            scalarCount=len(llm_config.scalar_keys),
            tableCount=len(llm_config.table_bindings),
            attachmentMode=attachment_mode,
        )
        extracted = extract_template_render_data(quote_text, llm_config, extra_info)
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

    supplier_patch: dict[str, Any] = {"matched": False, "patch": {}, "reason": "not_attempted"}
    try:
        supplier_patch = supplier_patch_from_yonbip(extracted)
        overwritten = apply_yonbip_supplier_patch(extracted, supplier_patch)
        supplier_patch["appliedFields"] = sorted(overwritten)
        supplier_patch["overwrittenFields"] = sorted(overwritten)
        log_info(
            "field preview yonbip supplier patch finished",
            uploadId=upload_id,
            templateType=config.type,
            source=supplier_patch.get("source"),
            matched=supplier_patch.get("matched"),
            overwrittenFields=supplier_patch.get("overwrittenFields"),
            missingYonbipFields=supplier_patch.get("missingYonbipFields"),
            reason=supplier_patch.get("reason"),
        )
    except Exception as exc:
        supplier_patch = {"source": "yonbip", "matched": False, "patch": {}, "reason": "lookup_error", "error": str(exc)}
        log_warning(
            "field preview yonbip supplier patch failed",
            uploadId=upload_id,
            templateType=config.type,
            error=str(exc),
        )

    classify_start = time.perf_counter()
    log_info(
        "field preview stage",
        stage="classify_start",
        uploadId=upload_id,
        templateType=config.type,
    )
    classify_config = scalar_only_template_config(config) if attachment_mode.get("enabled") else config
    field_summary = classify_extracted_fields(extracted, classify_config)
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
        attachmentMode=attachment_mode,
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
        "attachmentMode": attachment_mode,
        "tableMode": table_mode,
        "extractedData": extracted,
        "supplierPatch": supplier_patch,
        **field_summary,
    }


@app.post("/api/contracts/generate")
async def generate_contract_api(request: Request, current_user: dict = Depends(get_current_user)) -> dict[str, Any]:
    start = time.perf_counter()
    client_host = request.client.host if request.client else None
    try:
        payload = await request.json()
    except Exception as exc:
        raise api_error(400, "INVALID_ARGUMENT", "生成合同请求体格式不正确") from exc
    if not isinstance(payload, dict):
        raise api_error(400, "INVALID_ARGUMENT", "生成合同请求体格式不正确")
    upload_id = str(payload.get("uploadId") or "").strip()
    template_type = str(payload.get("templateType") or "caigouhetong").strip()
    table_mode = normalize_table_mode(payload.get("tableMode"))
    quote_text_value = payload.get("quoteText")
    quote_text = quote_text_value.strip() if isinstance(quote_text_value, str) and quote_text_value.strip() else None
    extra_info_value = payload.get("extraInfo")
    extra_info = extra_info_value.strip() if isinstance(extra_info_value, str) and extra_info_value.strip() else None
    extracted_data_value = payload.get("extractedData")
    extracted_data = extracted_data_value if isinstance(extracted_data_value, dict) else None
    if not upload_id:
        raise api_error(400, "INVALID_ARGUMENT", "缺少上传文件 ID")
    log_info(
        "contract generate api request start",
        clientHost=client_host,
        uploadId=upload_id,
        templateType=template_type,
        tableMode=table_mode,
        confirmedQuoteText=bool(quote_text),
        extraInfoLength=len(extra_info or ""),
        confirmedExtractedData=bool(extracted_data),
        dingtalkUserId=current_user.get("userid"),
    )
    try:
        draft = generate_contract(upload_id, template_type, quote_text, extra_info, extracted_data, current_user, table_mode)
        download_payload = contract_download_payload(draft)
        log_info(
            "contract generate api request finished",
            clientHost=client_host,
            uploadId=upload_id,
            templateType=template_type,
            contractId=draft.get("contractId"),
            elapsedMs=elapsed_ms(start),
        )
        return {"ok": True, **download_payload}
    except HTTPException:
        raise
    except Exception as exc:
        code, message = error_code_message(exc)
        log_exception("contract generate api request failed", exc, uploadId=upload_id, templateType=template_type, code=code, elapsedMs=elapsed_ms(start))
        raise api_error(500, code, message, str(exc)) from exc


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


@app.get("/config.js")
def frontend_config_js() -> Response:
    body = (
        f"window.__DINGTALK_CLIENT_ID__ = {json.dumps(dingtalk_client_id(), ensure_ascii=False)};\n"
        f"window.__DINGTALK_CORP_ID__ = {json.dumps(dingtalk_corp_id(), ensure_ascii=False)};\n"
    )
    return Response(content=body, media_type="application/javascript; charset=utf-8")


@app.get("/{path:path}")
def serve_frontend(path: str) -> FileResponse:
    if not STATIC_DIR.exists():
        raise api_error(404, "NOT_FOUND", "H5 静态资源未构建")
    relative = "index.html" if path in {"", "h5"} else path
    candidate = (STATIC_DIR / relative).resolve()
    static_root = STATIC_DIR.resolve()
    if static_root not in candidate.parents and candidate != static_root:
        raise api_error(404, "NOT_FOUND", "资源不存在")
    if not candidate.is_file():
        candidate = static_root / "index.html"
    if not candidate.is_file():
        raise api_error(404, "NOT_FOUND", "资源不存在")
    return FileResponse(candidate)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "9000")))
