from __future__ import annotations

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
