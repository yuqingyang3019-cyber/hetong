from __future__ import annotations

from copy import deepcopy
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
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt
from docxtpl import DocxTemplate, RichText

from .config import CONTRACTS_DIR, TemplateConfig, ensure_storage, template_docx_path

RICH_TEXT_FONT = "eastAsia:仿宋"
RICH_TEXT_SIZE = 21
TABLE_TEXT_FONT = "仿宋"
TABLE_TEXT_SIZE_PT = 10.5
LEFT_ALIGNED_HEADER_TABLE_COUNT = 2
UNDERLINE_BLANK = "        "
LogFunc = Callable[..., None]
PAYMENT_TERMS_OVERRIDE_KEY = "paymentTermsOverride"
ATTACHMENT_DETAIL_REF = "详情见附件"
TITLE_SCALAR_KEYS = ("purchaseSubject", "workDescription", "projectName", "engineeringScope")
TITLE_COLUMN_KEYS = ("name", "laborItem", "node")
DETAIL_COLUMN_KEYS = ("spec", "remark", "progressDescription")
AMOUNT_SCALAR_KEY = "totalAmount"
AMOUNT_COLUMN_KEY = "totalPrice"
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
    PAYMENT_TERMS_OVERRIDE_KEY,
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


def _rich_text_multiline(value: Any, label: str, blank_missing: bool = False) -> RichText:
    text = _value_for_context(value, label, blank_missing)
    rich_text = RichText()
    lines = text.splitlines() or [""]
    for index, line in enumerate(lines):
        if index:
            rich_text.add("\n", font=RICH_TEXT_FONT, size=RICH_TEXT_SIZE, underline=False)
        rich_text.add(line, font=RICH_TEXT_FONT, size=RICH_TEXT_SIZE, underline=False)
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


def _first_non_empty_scalar(scalars: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = _stringify(scalars.get(key)).strip()
        if value:
            return value
    return ""


def _first_column(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    return None


def build_attachment_summary_row(columns: list[str], scalars: dict[str, Any]) -> dict[str, str]:
    row = {column: "" for column in columns}
    if "index" in row:
        row["index"] = "1"
    title_column = _first_column(columns, TITLE_COLUMN_KEYS)
    if title_column:
        row[title_column] = _first_non_empty_scalar(scalars, TITLE_SCALAR_KEYS)
    detail_column = _first_column(columns, DETAIL_COLUMN_KEYS)
    if detail_column:
        row[detail_column] = ATTACHMENT_DETAIL_REF
    if AMOUNT_COLUMN_KEY in row:
        row[AMOUNT_COLUMN_KEY] = _stringify(scalars.get(AMOUNT_SCALAR_KEY)).strip()
    return row


def apply_attachment_table_summary(render_data: dict[str, Any], config: TemplateConfig) -> None:
    for table_name, columns in config.table_bindings.items():
        if not columns:
            continue
        render_data[table_name] = [build_attachment_summary_row(columns, render_data)]


def build_docxtpl_context(render_data: dict[str, Any], config: TemplateConfig, blank_missing: bool = False) -> dict[str, Any]:
    scalar_labels = {field["key"]: field["label"] for field in config.schema.get("scalars", [])}
    context: dict[str, Any] = {}
    override_text = _stringify(render_data.get(PAYMENT_TERMS_OVERRIDE_KEY)).strip()
    context["hasPaymentTermsOverride"] = bool(override_text)
    for key in config.scalar_keys:
        if key == PAYMENT_TERMS_OVERRIDE_KEY:
            continue
        context[key] = _rich_text(
            render_data.get(key),
            scalar_labels.get(key, key),
            blank_missing,
            underline=key not in NO_UNDERLINE_SCALAR_KEYS,
        )
    context[PAYMENT_TERMS_OVERRIDE_KEY] = (
        _rich_text_multiline(override_text, scalar_labels.get(PAYMENT_TERMS_OVERRIDE_KEY, "付款期限覆盖内容"), blank_missing)
        if override_text
        else RichText()
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


def _set_run_font(run: Any, font_name: str = TABLE_TEXT_FONT, size_pt: float = TABLE_TEXT_SIZE_PT) -> None:
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), font_name)


def _format_template_tables(path: Path) -> None:
    doc = Document(str(path))
    for table_index, table in enumerate(doc.tables):
        alignment = (
            WD_ALIGN_PARAGRAPH.LEFT
            if table_index < LEFT_ALIGNED_HEADER_TABLE_COUNT
            else WD_ALIGN_PARAGRAPH.CENTER
        )
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    paragraph.alignment = alignment
                    for run in paragraph.runs:
                        _set_run_font(run)
    doc.save(str(path))


def _add_attachment_heading(doc: Any, text: str, level: int) -> None:
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER if level == 1 else WD_ALIGN_PARAGRAPH.LEFT
    run = paragraph.add_run(text)
    run.bold = True
    _set_run_font(run, size_pt=14 if level == 1 else TABLE_TEXT_SIZE_PT)


def _set_table_grid_borders(table: Any) -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), "000000")


def _set_table_autofit_layout(table: Any) -> None:
    tbl_pr = table._tbl.tblPr
    layout = tbl_pr.first_child_found_in("w:tblLayout")
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "autofit")


def _strip_caigouhetong_attachment_section(path: Path, config: TemplateConfig, table_mode: str) -> None:
    if config.type != "caigouhetong" or table_mode == "attachment":
        return
    doc = Document(str(path))
    attachment_paragraph = next((paragraph for paragraph in doc.paragraphs if paragraph.text.strip() == "附件一：设备采购清单"), None)
    if attachment_paragraph is None:
        return

    body = doc.element.body
    attachment_element = attachment_paragraph._element
    previous_element = attachment_element.getprevious()
    previous_section = None
    if previous_element is not None and previous_element.tag == qn("w:p"):
        previous_props = previous_element.find(qn("w:pPr"))
        if previous_props is not None:
            previous_section = previous_props.find(qn("w:sectPr"))
    if previous_section is not None and body.sectPr is not None:
        body.replace(body.sectPr, deepcopy(previous_section))
        previous_section.getparent().remove(previous_section)

    removable_elements = [attachment_element]
    cursor = attachment_element.getnext()
    while cursor is not None and cursor.tag == qn("w:p"):
        texts = [node.text or "" for node in cursor.iter(qn("w:t"))]
        if any(text.strip() for text in texts):
            break
        removable_elements.append(cursor)
        cursor = cursor.getnext()
    for element in removable_elements:
        parent = element.getparent()
        if parent is not None:
            parent.remove(element)
    doc.save(str(path))


def append_quote_attachment(path: Path, quote_attachment: dict[str, Any] | None, logger: LogFunc | None = None) -> None:
    sheets = quote_attachment.get("sheets") if isinstance(quote_attachment, dict) else None
    if not isinstance(sheets, list):
        return
    valid_sheets: list[tuple[str, list[list[str]]]] = []
    for sheet in sheets:
        rows = _non_empty_rows(sheet.get("rows") if isinstance(sheet, dict) else None)
        if not rows:
            continue
        sheet_name = str(sheet.get("name") or "Sheet") if isinstance(sheet, dict) else "Sheet"
        valid_sheets.append((sheet_name, rows))
    if not valid_sheets:
        return

    start = time.perf_counter()
    doc = Document(str(path))
    doc.add_page_break()
    _add_attachment_heading(doc, "附件：报价单明细", level=1)
    for sheet_name, rows in valid_sheets:
        _add_attachment_heading(doc, sheet_name, level=2)
        max_cols = max(len(row) for row in rows)
        table = doc.add_table(rows=len(rows), cols=max_cols)
        _set_table_autofit_layout(table)
        _set_table_grid_borders(table)
        for row_index, row in enumerate(rows):
            for col_index in range(max_cols):
                table.cell(row_index, col_index).text = row[col_index] if col_index < len(row) else ""
    doc.save(str(path))
    _log(logger, "quote attachment appended", outputFile=path.name, sheetCount=len(valid_sheets), elapsedMs=_elapsed_ms(start))


def render_contract(
    render_data: dict[str, Any],
    config: TemplateConfig,
    contract_id: str,
    blank_missing: bool = False,
    table_mode: str = "auto",
    quote_attachment: dict[str, Any] | None = None,
    logger: LogFunc | None = None,
) -> Path:
    ensure_storage()
    template_path = template_docx_path(config.type)
    output_path = CONTRACTS_DIR / f"{contract_id}.docx"
    if table_mode == "attachment" and config.table_bindings:
        apply_attachment_table_summary(render_data, config)
    template_start = time.perf_counter()
    doc = DocxTemplate(str(template_path))
    doc.render(build_docxtpl_context(render_data, config, blank_missing=blank_missing))
    doc.save(str(output_path))
    _strip_caigouhetong_attachment_section(output_path, config, table_mode)
    _format_template_tables(output_path)
    _log(logger, "contract template rendered", outputFile=output_path.name, templateType=config.type, elapsedMs=_elapsed_ms(template_start))
    append_quote_attachment(output_path, quote_attachment, logger)
    return output_path
