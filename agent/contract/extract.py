from __future__ import annotations

from html import escape
from pathlib import Path
from typing import Any


def _normalize_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).replace("\r", "\n").strip()


def _trim_empty_edges(rows: list[list[str]]) -> list[list[str]]:
    while rows and not any(cell.strip() for cell in rows[0]):
        rows.pop(0)
    while rows and not any(cell.strip() for cell in rows[-1]):
        rows.pop()
    if not rows:
        return []
    max_cols = max(len(row) for row in rows)
    normalized = [row + [""] * (max_cols - len(row)) for row in rows]
    keep_cols = [idx for idx in range(max_cols) if any(row[idx].strip() for row in normalized)]
    return [[row[idx] for idx in keep_cols] for row in normalized]


def _rows_to_tsv(rows: list[list[str]]) -> str:
    return "\n".join("\t".join(cell.replace("\n", " / ") for cell in row) for row in rows)


def _rows_to_html(rows: list[list[str]], name: str, attr: str = "sheet") -> str:
    lines = [f'<table {attr}="{escape(name, quote=True)}">']
    for row in rows:
        lines.append("  <tr>")
        for cell in row:
            lines.append(f"    <td>{escape(cell).replace(chr(10), '<br>')}</td>")
        lines.append("  </tr>")
    lines.append("</table>")
    return "\n".join(lines)


def extract_excel_text(path: Path) -> str:
    suffix = path.suffix.lower()
    sheets: list[tuple[str, list[list[str]]]] = []
    if suffix == ".xlsx":
        from openpyxl import load_workbook

        workbook = load_workbook(path, data_only=True, read_only=True)
        for sheet in workbook.worksheets:
            rows = [[_normalize_cell(cell) for cell in row] for row in sheet.iter_rows(values_only=True)]
            sheets.append((sheet.title, _trim_empty_edges(rows)))
    elif suffix == ".xls":
        import xlrd

        workbook = xlrd.open_workbook(str(path))
        for sheet in workbook.sheets():
            rows = [[_normalize_cell(sheet.cell_value(r, c)) for c in range(sheet.ncols)] for r in range(sheet.nrows)]
            sheets.append((sheet.name, _trim_empty_edges(rows)))
    else:
        raise ValueError(f"不支持的 Excel 扩展名：{suffix}")

    parts: list[str] = []
    for sheet_name, rows in sheets:
        if not rows:
            continue
        parts.append(f"--- 工作表：{sheet_name} ---")
        parts.append(f"[表格 parser=excel sheet={sheet_name}]")
        parts.append(_rows_to_html(rows, sheet_name))
        parts.append("[TSV]")
        parts.append(_rows_to_tsv(rows))
    text = "\n".join(parts).strip()
    if not text:
        raise ValueError("Excel 未解析到非空单元格")
    return text


def extract_pdf_text(path: Path) -> str:
    import pdfplumber

    table_settings = {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "snap_tolerance": 3,
        "join_tolerance": 3,
        "intersection_tolerance": 5,
        "text_x_tolerance": 2,
        "text_y_tolerance": 3,
    }
    text_table_settings = {
        "vertical_strategy": "text",
        "horizontal_strategy": "text",
        "snap_tolerance": 3,
        "join_tolerance": 3,
        "intersection_tolerance": 5,
        "min_words_vertical": 2,
        "min_words_horizontal": 1,
        "text_x_tolerance": 2,
        "text_y_tolerance": 3,
    }
    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            parts.append(f"--- 第 {page_no} 页 ---")
            page_tables = page.find_tables(table_settings=table_settings)
            parser_name = "pdfplumber-lines"
            if not page_tables:
                page_tables = page.find_tables(table_settings=text_table_settings)
                parser_name = "pdfplumber-text"
            for table_no, table in enumerate(page_tables, start=1):
                rows = [[_normalize_cell(cell) for cell in row] for row in (table.extract() or []) if row]
                if rows:
                    parts.append(f"[表格 parser={parser_name} page={page_no} index={table_no}]")
                    parts.append(_rows_to_html(rows, str(page_no), "page"))
                    parts.append("[TSV]")
                    parts.append(_rows_to_tsv(rows))
            text = (page.extract_text(x_tolerance=2, y_tolerance=3, layout=True) or "").strip()
            if text:
                parts.append(f"[第 {page_no} 页文字]")
                parts.append(text)
    result = "\n".join(parts).strip()
    if not result:
        raise ValueError("PDF 未解析到文本")
    return result


def extract_text_from_file(path: Path, mime_type: str = "") -> str:
    lower = path.name.lower()
    if mime_type.startswith("text/") or lower.endswith(".txt"):
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            raise ValueError("文本报价单内容为空")
        return text
    if lower.endswith((".xlsx", ".xls")) or "spreadsheet" in mime_type or "ms-excel" in mime_type:
        return extract_excel_text(path)
    if lower.endswith(".pdf") or mime_type == "application/pdf":
        return extract_pdf_text(path)
    raise ValueError("当前 Python H5 版本暂不支持图片 OCR，请先上传 PDF、Excel 或 TXT")
