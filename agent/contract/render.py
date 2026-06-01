from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from zoneinfo import ZoneInfo
except ModuleNotFoundError:
    def ZoneInfo(name: str) -> timezone:
        if name == "Asia/Shanghai":
            return timezone(timedelta(hours=8))
        return timezone.utc

from docx import Document
from docxtpl import DocxTemplate

from .config import CONTRACTS_DIR, TemplateConfig, ensure_storage, template_docx_path


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
        context[key] = _value_for_context(render_data.get(key), scalar_labels.get(key, key), blank_missing)
    for table_name, columns in config.table_bindings.items():
        table_def = config.schema.get("tables", {}).get(table_name, {})
        labels = {column["key"]: column["label"] for column in table_def.get("columns", [])}
        rows = render_data.get(table_name)
        mapped_rows: list[dict[str, str]] = []
        if isinstance(rows, list):
            for row in rows:
                source = row if isinstance(row, dict) else {}
                mapped_rows.append({
                    column: _value_for_context(source.get(column), labels.get(column, column), blank_missing)
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


def append_quote_attachment(path: Path, quote_attachment: dict[str, Any] | None) -> None:
    sheets = quote_attachment.get("sheets") if isinstance(quote_attachment, dict) else None
    if not isinstance(sheets, list):
        return
    doc = Document(str(path))
    doc.add_page_break()
    doc.add_heading("附件：报价单明细", level=1)
    for sheet in sheets:
        rows = _non_empty_rows(sheet.get("rows") if isinstance(sheet, dict) else None)
        if not rows:
            continue
        sheet_name = str(sheet.get("name") or "Sheet") if isinstance(sheet, dict) else "Sheet"
        doc.add_heading(sheet_name, level=2)
        max_cols = max(len(row) for row in rows)
        table = doc.add_table(rows=len(rows), cols=max_cols)
        table.style = "Table Grid"
        for row_index, row in enumerate(rows):
            for col_index in range(max_cols):
                table.cell(row_index, col_index).text = row[col_index] if col_index < len(row) else ""
    doc.save(str(path))


def render_contract(
    render_data: dict[str, Any],
    config: TemplateConfig,
    contract_id: str,
    blank_missing: bool = False,
    quote_attachment: dict[str, Any] | None = None,
) -> Path:
    ensure_storage()
    template_path = template_docx_path(config.type)
    output_path = CONTRACTS_DIR / f"{contract_id}.docx"
    doc = DocxTemplate(str(template_path))
    doc.render(build_docxtpl_context(render_data, config, blank_missing=blank_missing))
    doc.save(str(output_path))
    append_quote_attachment(output_path, quote_attachment)
    return output_path
