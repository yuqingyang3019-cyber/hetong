"""Patch supplementary-agreement.source.docx with docxtpl placeholders."""
from __future__ import annotations

import shutil
import zipfile
from copy import deepcopy
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_DIR = ROOT / "agent" / "contract" / "templates" / "zhanweifu"
SOURCE_PATH = TEMPLATE_DIR / "supplementary-agreement.source.docx"
OUTPUT_PATH = TEMPLATE_DIR / "supplementary-agreement.docx"
ROOT_SOURCE = ROOT / "增补协议模板.docx"
PLACEHOLDER_MARKER = "{{r contractNo }}"
OVERRIDE_BLOCK_MARKER = "{% if hasItemsContentOverride %}"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"
NS = {"w": W_NS}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def ensure_source() -> None:
    if not SOURCE_PATH.exists():
        if not ROOT_SOURCE.exists():
            raise FileNotFoundError(f"缺少母版文件：{SOURCE_PATH} 或 {ROOT_SOURCE}")
        shutil.copy2(ROOT_SOURCE, SOURCE_PATH)


def cell_text(cell: ET.Element) -> str:
    return "".join(node.text or "" for node in cell.iter(f"{W}t"))


def set_cell_text(cell: ET.Element, text: str) -> None:
    paragraphs = cell.findall("w:p", NS)
    if not paragraphs:
        paragraph = ET.SubElement(cell, f"{W}p")
    else:
        paragraph = paragraphs[0]
    for run in list(paragraph.findall("w:r", NS)):
        paragraph.remove(run)
    run = ET.SubElement(paragraph, f"{W}r")
    text_node = ET.SubElement(run, f"{W}t")
    text_node.text = text
    if text and (text[0] == " " or text[-1] == " "):
        text_node.set(XML_SPACE, "preserve")


def replace_in_paragraphs(parent: ET.Element, old: str, new: str) -> bool:
    for paragraph in parent.iter(f"{W}p"):
        text_nodes = list(paragraph.iter(f"{W}t"))
        combined = "".join(node.text or "" for node in text_nodes)
        if old not in combined:
            continue
        updated = combined.replace(old, new, 1)
        for index, node in enumerate(text_nodes):
            node.text = updated if index == 0 else ""
        return True
    return False


def require_replace(parent: ET.Element, old: str, new: str) -> None:
    if not replace_in_paragraphs(parent, old, new):
        raise RuntimeError(f"未找到锚点 {old!r}")


def clone_row_after(table: ET.Element, row_index: int) -> ET.Element:
    rows = table.findall("w:tr", NS)
    source_row = rows[row_index]
    new_row = deepcopy(source_row)
    insert_at = list(table).index(source_row) + 1
    table.insert(insert_at, new_row)
    return new_row


def paragraph_text(paragraph: ET.Element) -> str:
    return "".join(node.text or "" for node in paragraph.iter(f"{W}t"))


def make_paragraph(text: str) -> ET.Element:
    paragraph = ET.Element(f"{W}p")
    run = ET.SubElement(paragraph, f"{W}r")
    text_node = ET.SubElement(run, f"{W}t")
    text_node.text = text
    return paragraph


def insert_body_element_after(body: ET.Element, anchor: ET.Element, element: ET.Element) -> None:
    insert_at = list(body).index(anchor) + 1
    body.insert(insert_at, element)


def is_placeholder_patched(xml: str) -> bool:
    return PLACEHOLDER_MARKER in xml


def has_items_override_block(xml: str) -> bool:
    return OVERRIDE_BLOCK_MARKER in xml


def ensure_items_override_block(body: ET.Element) -> None:
    if any(
        OVERRIDE_BLOCK_MARKER in paragraph_text(child)
        for child in body.findall("w:p", NS)
    ):
        return

    intro_paragraph = next(
        (child for child in body if child.tag == f"{W}p" and paragraph_text(child).strip() == "协议内容补充部分为："),
        None,
    )
    items_table = next((child for child in body if child.tag == f"{W}tbl"), None)
    if intro_paragraph is None or items_table is None:
        raise RuntimeError("未找到协议内容补充段落或设备明细表")

    insert_body_element_after(body, intro_paragraph, make_paragraph("{% else %}"))
    insert_body_element_after(body, intro_paragraph, make_paragraph("{{r itemsContentOverride }}"))
    insert_body_element_after(body, intro_paragraph, make_paragraph("{% if hasItemsContentOverride %}"))
    insert_body_element_after(body, items_table, make_paragraph("{% endif %}"))


def patch_items_table(table: ET.Element) -> None:
    rows = table.findall("w:tr", NS)
    if cell_text(rows[0].findall("w:tc", NS)[1]) != "设备名称":
        raise RuntimeError("设备明细表表头结构已变更")

    set_cell_text(rows[1].findall("w:tc", NS)[0], "{%tr for item in items %}")
    data_row = clone_row_after(table, 1)
    item_columns = [
        "{{r item.index }}",
        "{{r item.name }}",
        "{{r item.spec }}",
        "{{r item.quantity }}",
        "{{r item.unit }}",
        "{{r item.unitPrice }}",
        "{{r item.totalPrice }}",
        "{{r item.remark }}",
    ]
    data_cells = data_row.findall("w:tc", NS)
    for index, placeholder in enumerate(item_columns):
        set_cell_text(data_cells[index], placeholder)

    end_row = clone_row_after(table, 2)
    set_cell_text(end_row.findall("w:tc", NS)[0], "{%tr endfor %}")

    rows = table.findall("w:tr", NS)
    total_row = next(row for row in rows if cell_text(row.findall("w:tc", NS)[0]) == "合计")
    total_cells = total_row.findall("w:tc", NS)
    set_cell_text(total_cells[1], "{{r totalAmount }}")

    for row in rows:
        cells = row.findall("w:tc", NS)
        label = cell_text(cells[0])
        if label == "合计人民币（大写）":
            set_cell_text(cells[1], "{{r totalAmountChinese }}")
        elif label == "最终优惠金额合计（大写）":
            set_cell_text(cells[1], "{{r discountAmountChinese }}")
        elif label == "不计税金额":
            set_cell_text(cells[1], "{{r amountWithoutTax }}")


def patch_signature_table(table: ET.Element) -> None:
    cells = table.findall("w:tr", NS)[0].findall("w:tc", NS)
    if not replace_in_paragraphs(cells[1], "乙方：", "乙方：{{r supplierName }}"):
        raise RuntimeError("未找到落款乙方单元格")


def patch_document_xml(xml: str) -> str:
    root = ET.fromstring(xml)
    body = root.find("w:body", NS)
    if body is None:
        raise RuntimeError("document.xml 缺少 body")

    if not is_placeholder_patched(xml):
        require_replace(body, "合同编号：", "合同编号：{{r contractNo }}")
        require_replace(body, "乙方（全称）：", "乙方（全称）：{{r supplierName }}")
        require_replace(
            body,
            "双方于 年 月 日签订合同编号为       的     采购合同",
            "双方于 {{r originalSignYear }} 年 {{r originalSignMonth }} 月 {{r originalSignDay }} 日签订合同编号为 {{r originalContractNo }} 的 {{r originalContractTitle }} 采购合同",
        )
        require_replace(body, "设计变更或采购需求变更。", "{{r amendmentReason }}")
        require_replace(
            body,
            "1.1供货时间：   年   月   日。",
            "1.1供货时间：{{r deliveryYear }} 年 {{r deliveryMonth }} 月 {{r deliveryDay }} 日。",
        )
        require_replace(body, "乙方：", "乙方：{{r supplierName }}")

        tables = body.findall("w:tbl", NS)
        if len(tables) < 2:
            raise RuntimeError("模板表格数量不足")
        patch_items_table(tables[0])
        patch_signature_table(tables[1])

    if not has_items_override_block(xml):
        ensure_items_override_block(body)

    ET.register_namespace("w", W_NS)
    return ET.tostring(root, encoding="unicode", xml_declaration=False)


def patch_docx(source: Path, output: Path) -> None:
    with zipfile.ZipFile(source, "r") as source_zip:
        entries = {name: source_zip.read(name) for name in source_zip.namelist()}
    entries["word/document.xml"] = patch_document_xml(entries["word/document.xml"].decode("utf-8")).encode("utf-8")
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as output_zip:
        for name, data in entries.items():
            output_zip.writestr(name, data)


def main() -> None:
    ensure_source()
    patch_docx(SOURCE_PATH, OUTPUT_PATH)
    print(f"Patched {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
