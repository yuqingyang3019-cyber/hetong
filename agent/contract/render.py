from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

try:
    from zoneinfo import ZoneInfo
except ModuleNotFoundError:
    def ZoneInfo(name: str) -> timezone:
        if name == "Asia/Shanghai":
            return timezone(timedelta(hours=8))
        return timezone.utc

from docx import Document
from docx.shared import Inches
from docxtpl import DocxTemplate, RichText

from .config import CONTRACTS_DIR, TemplateConfig, ensure_storage, template_docx_path

RICH_TEXT_FONT = "eastAsia:仿宋"
RICH_TEXT_SIZE = 21
UNDERLINE_BLANK = "        "
LogFunc = Callable[..., None]
NO_UNDERLINE_SCALAR_KEYS = {
    "signYear",
    "signMonth",
    "signDay",
    "signatureYear",
    "signatureMonth",
    "signatureDay",
    "supplierName",
    "supplierAddress",
    "supplierBank",
    "supplierAccount",
    "supplierTaxNo",
    "supplierPhone",
    "supplierFax",
    "supplierRepresentativeName",
    "supplierRepresentativeIdNo",
    "supplierRepresentativePhone",
    "supplierRepresentativeAddress",
    "supplierRepresentativeEmail",
    "buyerAuthorizedRepresentative",
    "supplierAuthorizedRepresentative",
}


def _stringify(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return str(value)


def _pending(label: str) -> str:
    return f"【待填写：{label}】"


def _value_for_context(value: Any, label: str, blank_missing: bool = False) -> str:
    if value is None or str(value).strip() == "":
        if blank_missing:
            return ""
        return _pending(label)
    return str(value)


def _rich_text(value: Any, label: str, blank_missing: bool = False, underline: bool = False) -> RichText:
    text = _value_for_context(value, label, blank_missing)
    if underline and blank_missing and not text.strip():
        text = UNDERLINE_BLANK
    rich_text = RichText()
    rich_text.add(text, font=RICH_TEXT_FONT, size=RICH_TEXT_SIZE, underline=underline)
    return rich_text


def _today_parts() -> dict[str, str]:
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    return {"year": f"{now.year}", "month": f"{now.month:02d}", "day": f"{now.day:02d}"}


def merge_render_data(patch: dict[str, Any], config: TemplateConfig) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in config.scalar_keys:
        out[key] = _stringify(patch.get(key))
    for table_name, columns in config.table_bindings.items():
        rows = patch.get(table_name)
        if not isinstance(rows, list):
            out[table_name] = []
            continue
        mapped_rows: list[dict[str, str]] = []
        for index, row in enumerate(rows):
            source = row if isinstance(row, dict) else {}
            mapped: dict[str, str] = {}
            for column in columns:
                fallback = str(index + 1) if column == "index" else ""
                mapped[column] = _stringify(source.get(column), fallback)
            mapped_rows.append(mapped)
        out[table_name] = mapped_rows
    parts = _today_parts()
    out.setdefault("signYear", parts["year"])
    out.setdefault("signMonth", parts["month"])
    out.setdefault("signDay", parts["day"])
    out.setdefault("signatureYear", parts["year"])
    out.setdefault("signatureMonth", parts["month"])
    out.setdefault("signatureDay", parts["day"])
    return out


def build_docxtpl_context(render_data: dict[str, Any], config: TemplateConfig, blank_missing: bool = False) -> dict[str, Any]:
    scalar_labels = {field["key"]: field["label"] for field in config.schema.get("scalars", [])}
    context: dict[str, Any] = {}
    for key in config.scalar_keys:
        context[key] = _rich_text(
            render_data.get(key),
            scalar_labels.get(key, key),
            blank_missing,
            underline=key not in NO_UNDERLINE_SCALAR_KEYS,
        )
    for table_name, columns in config.table_bindings.items():
        table_def = config.schema.get("tables", {}).get(table_name, {})
        labels = {column["key"]: column["label"] for column in table_def.get("columns", [])}
        rows = render_data.get(table_name)
        mapped_rows: list[dict[str, str]] = []
        if isinstance(rows, list):
            for row in rows:
                source = row if isinstance(row, dict) else {}
                mapped_rows.append({
                    column: _rich_text(source.get(column), labels.get(column, column), blank_missing, underline=False)
                    for column in columns
                })
        context[table_name] = mapped_rows
    return context


def _non_empty_rows(rows: Any) -> list[list[str]]:
    if not isinstance(rows, list):
        return []
    normalized: list[list[str]] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        cells = [_stringify(cell) for cell in row]
        if any(cell.strip() for cell in cells):
            normalized.append(cells)
    return normalized


def _elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def _log(logger: LogFunc | None, message: str, **meta: Any) -> None:
    if logger:
        logger(message, **meta)


def append_quote_attachment(path: Path, quote_attachment: dict[str, Any] | None, logger: LogFunc | None = None) -> None:
    sheets = quote_attachment.get("sheets") if isinstance(quote_attachment, dict) else None
    if not isinstance(sheets, list):
        return
    start = time.perf_counter()
    doc = Document(str(path))
    doc.add_page_break()
    doc.add_heading("附件：报价单明细", level=1)
    appended_sheet_count = 0
    for sheet in sheets:
        rows = _non_empty_rows(sheet.get("rows") if isinstance(sheet, dict) else None)
        if not rows:
            continue
        appended_sheet_count += 1
        sheet_name = str(sheet.get("name") or "Sheet") if isinstance(sheet, dict) else "Sheet"
        doc.add_heading(sheet_name, level=2)
        max_cols = max(len(row) for row in rows)
        table = doc.add_table(rows=len(rows), cols=max_cols)
        table.style = "Table Grid"
        for row_index, row in enumerate(rows):
            for col_index in range(max_cols):
                table.cell(row_index, col_index).text = row[col_index] if col_index < len(row) else ""
    doc.save(str(path))
    _log(logger, "quote attachment appended", outputFile=path.name, sheetCount=appended_sheet_count, elapsedMs=_elapsed_ms(start))


def append_drawing_attachment(path: Path, drawing_attachment: dict[str, Any] | None, logger: LogFunc | None = None) -> None:
    if not isinstance(drawing_attachment, dict):
        return
    image_path = Path(str(drawing_attachment.get("imagePath") or ""))
    if not image_path.exists():
        return
    start = time.perf_counter()
    original_name = str(drawing_attachment.get("originalName") or "图纸")
    doc = Document(str(path))
    doc.add_page_break()
    doc.add_heading("附件：图纸", level=1)
    doc.add_paragraph(original_name)
    doc.add_picture(str(image_path), width=Inches(6.5))
    doc.save(str(path))
    _log(
        logger,
        "drawing attachment appended",
        outputFile=path.name,
        imagePath=str(image_path),
        originalName=original_name,
        elapsedMs=_elapsed_ms(start),
    )


def render_contract(
    render_data: dict[str, Any],
    config: TemplateConfig,
    contract_id: str,
    blank_missing: bool = False,
    quote_attachment: dict[str, Any] | None = None,
    drawing_attachment: dict[str, Any] | None = None,
    logger: LogFunc | None = None,
) -> Path:
    ensure_storage()
    template_path = template_docx_path(config.type)
    output_path = CONTRACTS_DIR / f"{contract_id}.docx"
    template_start = time.perf_counter()
    doc = DocxTemplate(str(template_path))
    doc.render(build_docxtpl_context(render_data, config, blank_missing=blank_missing))
    doc.save(str(output_path))
    _log(logger, "contract template rendered", outputFile=output_path.name, templateType=config.type, elapsedMs=_elapsed_ms(template_start))
    append_quote_attachment(output_path, quote_attachment, logger)
    append_drawing_attachment(output_path, drawing_attachment, logger)
    return output_path
