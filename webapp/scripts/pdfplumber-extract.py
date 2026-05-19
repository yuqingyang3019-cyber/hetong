#!/usr/bin/env python3
import json
import sys
from typing import Any


def _normalize_cell(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\r", "\n").strip()


def _escape_attr(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _escape_cell(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br>")
    )


def _rows_to_tsv(rows: list[list[str]]) -> str:
    return "\n".join("\t".join(cell.replace("\n", " / ") for cell in row) for row in rows)


def _unique_sorted(values: list[float], tolerance: float = 1.5) -> list[float]:
    sorted_values = sorted(values)
    unique: list[float] = []
    for value in sorted_values:
        if not unique or abs(unique[-1] - value) > tolerance:
            unique.append(value)
        else:
            unique[-1] = (unique[-1] + value) / 2
    return unique


def _nearest_index(values: list[float], target: float) -> int:
    return min(range(len(values)), key=lambda index: abs(values[index] - target))


def _cell_text(page: Any, bbox: tuple[float, float, float, float]) -> str:
    try:
        cropped = page.crop(bbox)
        return _normalize_cell(cropped.extract_text(x_tolerance=2, y_tolerance=3) or "")
    except Exception:
        return ""


def _table_cells(page: Any, table: Any) -> list[dict[str, Any]]:
    raw_cells = [
        tuple(cell)
        for row in getattr(table, "rows", []) or []
        for cell in getattr(row, "cells", []) or []
        if cell
    ]
    if not raw_cells:
        raw_cells = [tuple(cell) for cell in getattr(table, "cells", []) or [] if cell]

    if not raw_cells:
        return []

    xs = _unique_sorted([coord for x0, _, x1, _ in raw_cells for coord in (x0, x1)])
    ys = _unique_sorted([coord for _, top, _, bottom in raw_cells for coord in (top, bottom)])
    seen: set[tuple[int, int, int, int]] = set()
    cells: list[dict[str, Any]] = []

    for bbox in raw_cells:
        x0, top, x1, bottom = bbox
        col = _nearest_index(xs, x0)
        col_end = _nearest_index(xs, x1)
        row = _nearest_index(ys, top)
        row_end = _nearest_index(ys, bottom)
        key = (row, col, row_end, col_end)
        if key in seen:
            continue
        seen.add(key)
        cells.append(
            {
                "row": row,
                "col": col,
                "rowspan": max(1, row_end - row),
                "colspan": max(1, col_end - col),
                "text": _cell_text(page, bbox),
                "bbox": [round(value, 2) for value in bbox],
            }
        )

    return sorted(cells, key=lambda cell: (cell["row"], cell["col"]))


def _cells_to_html(cells: list[dict[str, Any]], page_no: int, table_no: int, bbox: Any) -> str:
    if not cells:
        return ""

    row_count = max(cell["row"] + cell["rowspan"] for cell in cells)
    cells_by_row: dict[int, list[dict[str, Any]]] = {}
    for cell in cells:
        cells_by_row.setdefault(cell["row"], []).append(cell)

    lines = [
        f'<table page="{page_no}" index="{table_no}" bbox="{_escape_attr(json.dumps(bbox, ensure_ascii=False))}">'
    ]
    for row in range(row_count):
        lines.append("  <tr>")
        for cell in sorted(cells_by_row.get(row, []), key=lambda item: item["col"]):
            attrs = [f'col="{cell["col"] + 1}"']
            if cell["rowspan"] > 1:
                attrs.append(f'rowspan="{cell["rowspan"]}"')
            if cell["colspan"] > 1:
                attrs.append(f'colspan="{cell["colspan"]}"')
            lines.append(f"    <td {' '.join(attrs)}>{_escape_cell(cell['text'])}</td>")
        lines.append("  </tr>")
    lines.append("</table>")
    return "\n".join(lines)


def _table_rows(table: Any) -> list[list[str]]:
    try:
        raw_rows = table.extract(x_tolerance=2, y_tolerance=3) or []
    except Exception:
        raw_rows = []
    return [[_normalize_cell(cell) for cell in row] for row in raw_rows if row]


def _extract(pdf_path: str) -> dict[str, Any]:
    try:
        import pdfplumber  # type: ignore
    except Exception as exc:
        return {
            "text": "",
            "page_count": 0,
            "line_count": 0,
            "table_count": 0,
            "errors": [f"pdfplumber 不可用：{exc}"],
        }

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
    table_count = 0
    errors: list[str] = []

    with pdfplumber.open(pdf_path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            parts.append(f"--- 第 {page_no} 页 ---")
            page_tables = page.find_tables(table_settings=table_settings)
            parser_name = "pdfplumber-lines"
            if not page_tables:
                page_tables = page.find_tables(table_settings=text_table_settings)
                parser_name = "pdfplumber-text"

            for table_no, table in enumerate(page_tables, start=1):
                table_count += 1
                rows = _table_rows(table)
                cells = _table_cells(page, table)
                bbox = [round(value, 2) for value in getattr(table, "bbox", []) or []]
                parts.append(f"[表格 parser={parser_name} page={page_no} index={table_no}]")
                html = _cells_to_html(cells, page_no, table_no, bbox)
                if html:
                    parts.append(html)
                if rows:
                    parts.append("[TSV]")
                    parts.append(_rows_to_tsv(rows))

            text = (page.extract_text(x_tolerance=2, y_tolerance=3, layout=True) or "").strip()
            if text:
                parts.append(f"[第 {page_no} 页文字]")
                parts.append(text)

    text = "\n".join(part for part in parts if part).strip()
    return {
        "text": text,
        "page_count": len(pdf.pages),
        "line_count": len([line for line in text.splitlines() if line.strip()]),
        "table_count": table_count,
        "errors": errors,
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("用法：pdfplumber-extract.py <PDF路径>")
    result = _extract(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
