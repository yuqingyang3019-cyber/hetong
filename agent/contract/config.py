from __future__ import annotations

import errno
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_ROOT = APP_ROOT / "contract"
TEMPLATE_ROOT = CONTRACT_ROOT / "templates" / "zhanweifu"
STORAGE_ROOT = APP_ROOT / "storage"
UPLOADS_DIR = STORAGE_ROOT / "uploads"
CONTRACTS_DIR = STORAGE_ROOT / "contracts"
MAX_STORED_FILE_NAME_BYTES = 255
MAX_QUOTE_ORIGINAL_NAME_BYTES = 512


DEFAULT_TEMPLATE_TYPE = "simpleContract"

TEMPLATE_BASENAME: dict[str, str] = {
    "caigouhetong": "caigouhetong",
    "nonStandardNoInstall": "non-standard-no-install",
    "nonStandardWithInstall": "non-standard-with-install",
    "annualFramework": "annual-framework",
    "professionalSubcontract": "professional-subcontract",
    "laborSubcontract": "labor-subcontract",
    "simpleContract": "simple-contract",
    "supplementaryAgreement": "supplementary-agreement",
}

TEMPLATE_DISPLAY_NAME: dict[str, str] = {
    "caigouhetong": "采购合同（通用设备）",
    "nonStandardNoInstall": "设备采购合同（不含安装）",
    "nonStandardWithInstall": "设备采购合同（含安装）",
    "annualFramework": "年度采购框架合同",
    "professionalSubcontract": "专业工程分包合同",
    "laborSubcontract": "劳务分包合同（清包工）",
    "simpleContract": "简易合同（产品购销）",
    "supplementaryAgreement": "合同补充协议书",
}


@dataclass(frozen=True)
class TemplateTypography:
    east_asia: str
    size_half_pt: int

    @property
    def rich_text_font(self) -> str:
        return f"eastAsia:{self.east_asia}"

    @property
    def size_pt(self) -> float:
        return self.size_half_pt / 2


_FANGSONG_WUHAO = TemplateTypography(east_asia="仿宋", size_half_pt=21)
_FANGSONG_XIAOSI = TemplateTypography(east_asia="仿宋", size_half_pt=24)
_SONGTI_WUHAO = TemplateTypography(east_asia="宋体", size_half_pt=21)
_SONGTI_XIAOSI = TemplateTypography(east_asia="宋体", size_half_pt=24)

TEMPLATE_TYPOGRAPHY: dict[str, TemplateTypography] = {
    "caigouhetong": _FANGSONG_WUHAO,
    "nonStandardNoInstall": _FANGSONG_WUHAO,
    "nonStandardWithInstall": _FANGSONG_WUHAO,
    "annualFramework": _FANGSONG_WUHAO,
    "laborSubcontract": _FANGSONG_XIAOSI,
    "professionalSubcontract": _FANGSONG_XIAOSI,
    "simpleContract": _SONGTI_WUHAO,
    "supplementaryAgreement": _SONGTI_XIAOSI,
}


@dataclass(frozen=True)
class TemplateConfig:
    type: str
    display_name: str
    schema: dict[str, Any]
    scalar_keys: list[str]
    table_bindings: dict[str, list[str]]


def ensure_storage() -> None:
    for directory in (UPLOADS_DIR, CONTRACTS_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def safe_file_name(name: str) -> str:
    allowed = []
    for char in name:
        if char.isalnum() or char in "._-()（）【】":
            allowed.append(char)
        else:
            allowed.append("_")
    return "".join(allowed) or "file"


def truncate_file_name_to_bytes(name: str, max_bytes: int) -> str:
    if max_bytes <= 0:
        return "file"
    if len(name.encode("utf-8")) <= max_bytes:
        return name
    suffix = Path(name).suffix
    stem = name[: -len(suffix)] if suffix else name
    suffix_bytes = suffix.encode("utf-8")
    if len(suffix_bytes) >= max_bytes:
        truncated = name.encode("utf-8")[:max_bytes]
        while truncated:
            try:
                return truncated.decode("utf-8")
            except UnicodeDecodeError:
                truncated = truncated[:-1]
        return "file"
    max_stem_bytes = max_bytes - len(suffix_bytes)
    stem_bytes = stem.encode("utf-8")
    if len(stem_bytes) <= max_stem_bytes:
        return name
    truncated_stem_bytes = stem_bytes[:max_stem_bytes]
    while truncated_stem_bytes:
        try:
            return f"{truncated_stem_bytes.decode('utf-8')}{suffix}"
        except UnicodeDecodeError:
            truncated_stem_bytes = truncated_stem_bytes[:-1]
    return f"file{suffix}" if len(suffix.encode("utf-8")) <= max_bytes else "file"


def stored_upload_file_name(upload_id: str, original_name: str) -> str:
    prefix = f"{upload_id}_"
    safe = safe_file_name(original_name)
    max_safe_bytes = MAX_STORED_FILE_NAME_BYTES - len(prefix.encode("utf-8"))
    if max_safe_bytes < 1:
        raise OSError(errno.ENAMETOOLONG, "File name too long", prefix + safe)
    file_name = prefix + truncate_file_name_to_bytes(safe, max_safe_bytes)
    if len(file_name.encode("utf-8")) > MAX_STORED_FILE_NAME_BYTES:
        raise OSError(errno.ENAMETOOLONG, "File name too long", file_name)
    return file_name


def template_basename(template_type: str) -> str:
    if template_type not in TEMPLATE_BASENAME:
        raise ValueError(f"不支持的合同模板：{template_type}")
    return TEMPLATE_BASENAME[template_type]


def template_docx_path(template_type: str) -> Path:
    return TEMPLATE_ROOT / f"{template_basename(template_type)}.docx"


def template_schema_path(template_type: str) -> Path:
    return TEMPLATE_ROOT / f"{template_basename(template_type)}.placeholders.json"


def get_template_typography(template_type: str) -> TemplateTypography:
    if template_type not in TEMPLATE_TYPOGRAPHY:
        raise ValueError(f"不支持的合同模板：{template_type}")
    return TEMPLATE_TYPOGRAPHY[template_type]


@lru_cache(maxsize=16)
def get_template_config(template_type: str) -> TemplateConfig:
    mapped = template_type
    if mapped not in TEMPLATE_BASENAME:
        raise ValueError(f"不支持的合同模板：{template_type}")
    schema_path = template_schema_path(mapped)
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    scalar_keys = [field["key"] for field in schema.get("scalars", [])]
    table_bindings = {
        table_name: [column["key"] for column in table_def.get("columns", [])]
        for table_name, table_def in schema.get("tables", {}).items()
    }
    return TemplateConfig(
        type=mapped,
        display_name=TEMPLATE_DISPLAY_NAME[mapped],
        schema=schema,
        scalar_keys=scalar_keys,
        table_bindings=table_bindings,
    )
