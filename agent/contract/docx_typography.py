from __future__ import annotations

from typing import Any

from docx.oxml.ns import qn
from docx.shared import Pt

HEADING_SIZE_HALF_PT = 28


def run_size_half_pt(run: Any) -> int | None:
    r_pr = run._element.rPr
    if r_pr is None:
        return None
    sz_el = r_pr.find(qn("w:sz"))
    if sz_el is None:
        return None
    value = sz_el.get(qn("w:val"))
    return int(value) if value else None


def is_heading_run(run: Any) -> bool:
    size = run_size_half_pt(run)
    return size is not None and size >= HEADING_SIZE_HALF_PT


def apply_run_typography(run: Any, east_asia: str, size_half_pt: int) -> None:
    run.font.name = east_asia
    run.font.size = Pt(size_half_pt / 2)
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.get_or_add_rFonts()
    r_fonts.set(qn("w:eastAsia"), east_asia)
    r_fonts.set(qn("w:ascii"), east_asia)
    r_fonts.set(qn("w:hAnsi"), east_asia)
    sz = r_pr.get_or_add_sz()
    sz.set(qn("w:val"), str(size_half_pt))


def normalize_run_if_body(run: Any, east_asia: str, size_half_pt: int) -> None:
    if is_heading_run(run):
        return
    apply_run_typography(run, east_asia, size_half_pt)
