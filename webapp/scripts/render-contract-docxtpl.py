#!/usr/bin/env python3
"""Render a contract .docx using docxtpl (Jinja2 in Word).

Usage:
  python3 render-contract-docxtpl.py <template.docx> <context.json> <output.docx>

Context JSON must be a flat object of scalars plus an ``items`` array of row objects.
"""
from __future__ import annotations

import json
import sys


def main() -> None:
    if len(sys.argv) != 4:
        sys.stderr.write("用法：render-contract-docxtpl.py <模板.docx> <context.json> <输出.docx>\n")
        sys.exit(1)
    template_path, context_path, output_path = sys.argv[1:4]
    with open(context_path, encoding="utf-8") as handle:
        context = json.load(handle)
    if context.get("items") is None:
        context["items"] = []
    if context.get("priceItems") is None:
        context["priceItems"] = []

    from docxtpl import DocxTemplate  # noqa: PLC0415 — 延迟导入便于无依赖时尽早报错

    doc = DocxTemplate(template_path)
    doc.render(context)
    doc.save(output_path)


if __name__ == "__main__":
    main()
