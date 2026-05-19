import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { execFileSync } from "child_process";
import PizZip from "pizzip";

const appRoot = process.cwd();
const workspaceRoot = path.resolve(appRoot, "..");
const archivePath = path.join(workspaceRoot, "合同模板.rar");
const originalDir = path.join(appRoot, "templates", "original");
const docxDir = path.join(appRoot, "templates", "docx");
const placeholderDir = path.join(appRoot, "templates", "placeholder");

const sourceFiles = {
  "general-equipment.docx": "【通用设备】采购合同20250422.docx",
  "non-standard-no-install.docx": "【非标设备(不含安装)】采购合同20250422.docx",
  "non-standard-with-install.docx": "【非标设备(含安装)】采购合同20250422.docx",
  "annual-framework.docx": "年度框架协议模板.docx",
  "professional-subcontract.docx": "专业分包合同模板.doc",
  "labor-subcontract.docx": "劳务分包合同（清包工）.doc",
};

function ensureDirs() {
  for (const dir of [originalDir, docxDir, placeholderDir]) {
    mkdirSync(dir, { recursive: true });
  }
}

function extractArchive() {
  if (!existsSync(archivePath)) {
    throw new Error(`Missing archive: ${archivePath}`);
  }
  execFileSync("bsdtar", ["-xf", archivePath, "-C", originalDir], { stdio: "inherit" });
}

function convertDocToDocx(inputName, outputName) {
  const inputPath = path.join(originalDir, inputName);
  const outputPath = path.join(docxDir, outputName);
  execFileSync("textutil", ["-convert", "docx", "-output", outputPath, inputPath], { stdio: "inherit" });
}

function copyDocx(inputName, outputName) {
  copyFileSync(path.join(originalDir, inputName), path.join(docxDir, outputName));
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 保留 <w:tcPr> 与合并单元格，只替换单元格内首段正文为占位符文本 */
function setCellFirstParagraphText(cellXml, displayText) {
  const escaped = xmlEscape(displayText);
  if (!/<w:p[\s\S]*?<\/w:p>/.test(cellXml)) {
    return cellXml.replace("</w:tc>", `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p></w:tc>`);
  }
  return cellXml.replace(/<w:p[\s\S]*?<\/w:p>/, `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`, 1);
}

function patchDataRowWithPlaceholders(rowXml, cellTexts) {
  const cells = rowXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
  const trM = rowXml.match(/^<w:tr([^>]*)>/);
  const trOpen = trM ? `<w:tr${trM[1]}>` : "<w:tr>";
  if (cells.length === 0) return rowXml;
  const nCells = cells.length;
  const texts = [...cellTexts];
  while (texts.length < nCells) texts.push("");
  const limited = texts.slice(0, nCells);
  const newCells = cells.map((cell, i) => setCellFirstParagraphText(cell, limited[i] ?? ""));
  return trOpen + newCells.join("") + "</w:tr>";
}

function findTableBoundsByMarkers(xml, markers) {
  let search = 0;
  while (true) {
    const start = xml.indexOf("<w:tbl", search);
    if (start === -1) return null;
    const endRel = xml.indexOf("</w:tbl>", start);
    if (endRel === -1) return null;
    const end = endRel + "</w:tbl>".length;
    const slice = xml.slice(start, end);
    if (markers.every((m) => slice.includes(m))) {
      return { start, end, tableXml: slice };
    }
    search = start + 6;
  }
}

function getTableRows(tableXml) {
  return tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
}

function scoreHeaderRow(rowXml) {
  const keys = ["名称", "规格", "型号", "数量", "单价", "总价", "金额", "序号", "单位", "位号", "设备", "交货"];
  let s = 0;
  for (const k of keys) {
    if (rowXml.includes(k)) s++;
  }
  return s;
}

function findHeaderAndDataRowIndices(rows) {
  let bestH = -1;
  let bestScore = 0;
  for (let i = 0; i < rows.length; i++) {
    const sc = scoreHeaderRow(rows[i]);
    if (sc > bestScore) {
      bestScore = sc;
      bestH = i;
    }
  }
  if (bestH < 0 || bestScore < 2) return { headerIdx: -1, dataIdx: -1 };
  const dataIdx = bestH + 1 < rows.length ? bestH + 1 : -1;
  return { headerIdx: bestH, dataIdx };
}

function removeRowsContainingTokenInTable(tableXml, tokens) {
  let t = tableXml;
  for (const token of tokens) {
    const re = new RegExp(`<w:tr(?:(?!</w:tr>)[\\s\\S])*?<w:t>${xmlEscape(token)}</w:t>(?:(?!</w:tr>)[\\s\\S])*?</w:tr>`, "g");
    t = t.replace(re, "");
  }
  return t;
}

function cell(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p></w:tc>`;
}

function tableRow(cells) {
  return `<w:tr>${cells.map(cell).join("")}</w:tr>`;
}

function replaceRowContaining(xml, token, row) {
  const re = new RegExp(`<w:tr(?:(?!</w:tr>)[\\s\\S])*?<w:t>${xmlEscape(token)}</w:t>(?:(?!</w:tr>)[\\s\\S])*?</w:tr>`);
  return xml.replace(re, row);
}

function removeRowsContaining(xml, tokens) {
  for (const token of tokens) {
    const re = new RegExp(`<w:tr(?:(?!</w:tr>)[\\s\\S])*?<w:t>${xmlEscape(token)}</w:t>(?:(?!</w:tr>)[\\s\\S])*?</w:tr>`);
    xml = xml.replace(re, "");
  }
  return xml;
}

function replaceText(xml) {
  const replacements = [
    [/合同编号：WH-PO202【】/g, "合同编号：{contractNo}"],
    [/合同编号：WHPO-P202【】/g, "合同编号：{contractNo}"],
    [/合同编号：WH-PO202/g, "合同编号：{contractNo}"],
    [/合同编号：/g, "合同编号：{contractNo}"],
    [/签订日期：202【】年【】月【】日/g, "签订日期：{signDateText}"],
    [/签订日期：2025年\s*月\s*日/g, "签订日期：{signDateText}"],
    [/乙方（卖方）：\s*/g, "乙方（卖方）：{supplier.name}"],
    [/供方（乙方）：/g, "供方（乙方）：{supplier.name}"],
    [/分包方（乙方）：/g, "分包方（乙方）：{supplier.name}"],
    [/乙方地址[：:]\s*/g, "乙方地址：{supplier.address}"],
    [/乙方开户银行[：:]\s*/g, "乙方开户银行：{supplier.bank}"],
    [/乙方账号[：:]\s*/g, "乙方账号：{supplier.account}"],
    [/乙方税号[：:]\s*/g, "乙方税号：{supplier.taxNo}"],
    [/乙方联系电话[：:]\s*/g, "乙方联系电话：{supplier.phone}"],
    [/合同总价为¥\s*元整（大写金额：\s*元整）/g, "合同总价为¥{totalAmount}元整（大写金额：{totalAmountChinese}元整）"],
    [/人民币大写：【】（小写：【】）/g, "人民币大写：{totalAmountChinese}（小写：{totalAmount}）"],
    [/202【】年【】月【】日/g, "{deliveryDateText}"],
    [/安装调试周期：货到甲方指定地点且经初步验收合格后，乙方应在【】日内完成安装调试。/g, "安装调试周期：货到甲方指定地点且经初步验收合格后，乙方应在{installPeriodDays}日内完成安装调试。"],
    [/付款方式[：:]\s*/g, "付款方式：{paymentTerms}"],
    [/交货期限[：:]\s*/g, "交货期限：{deliveryDays}"],
    [/报价单号[：:]\s*/g, "报价单号：{quoteNo}"],
    [/项目名称[：:]\s*/g, "项目名称：{projectName}"],
    [/采购标的[：:]\s*/g, "采购标的：{purchaseSubject}"],
  ];
  for (const [pattern, value] of replacements) {
    xml = xml.replace(pattern, value);
  }
  return xml;
}

/** 设备类明细表：在原表格行结构上写入 docxtemplater 循环占位符 */
function patchEquipmentTablePreserve(xml) {
  const bounds = findTableBoundsByMarkers(xml, ["数量", "单价"]);
  if (!bounds) {
    console.warn("[prepare-templates] equipment table not found by markers, using legacy row patch");
    return patchEquipmentTableLegacy(xml);
  }
  const { start, end, tableXml } = bounds;
  const rows = getTableRows(tableXml);
  const { dataIdx } = findHeaderAndDataRowIndices(rows);
  if (dataIdx < 0 || dataIdx >= rows.length) {
    console.warn("[prepare-templates] equipment data row not found, using legacy row patch");
    return patchEquipmentTableLegacy(xml);
  }
  const dataRow = rows[dataIdx];
  const nCells = (dataRow.match(/<w:tc/g) || []).length;
  const desired = ["{#items}{index}", "{name}", "{spec}", "{unit}", "{quantity}", "{unitPrice}", "{totalPrice}", "{tagNo}{/items}"];
  const cellTexts = desired.slice(0, Math.max(nCells, 1));
  while (cellTexts.length < nCells) cellTexts.push("");
  const newRow = patchDataRowWithPlaceholders(dataRow, cellTexts);
  let newTable = tableXml.replace(dataRow, newRow);
  newTable = removeRowsContainingTokenInTable(newTable, ["2", "3", "4"]);
  return xml.slice(0, start) + newTable + xml.slice(end);
}

function patchEquipmentTableLegacy(xml) {
  const loopRow = tableRow([
    "{#items}{index}",
    "{name}",
    "{spec}",
    "{unit}",
    "{quantity}",
    "{unitPrice}",
    "{totalPrice}",
    "{tagNo}{/items}",
  ]);
  xml = replaceRowContaining(xml, "1", loopRow);
  return removeRowsContaining(xml, ["2", "3", "4"]);
}

/** 年度框架订单明细表；成功返回 { xml, ok: true }，失败返回 { xml: 原 xml, ok: false } 以便整体回退 legacy */
function patchAnnualOrderTablePreserve(xml) {
  const bounds = findTableBoundsByMarkers(xml, ["单价", "数量", "名称"]);
  if (!bounds) {
    console.warn("[prepare-templates] annual order table not found by markers");
    return { xml, ok: false };
  }
  const { start, end, tableXml } = bounds;
  const rows = getTableRows(tableXml);
  const { dataIdx } = findHeaderAndDataRowIndices(rows);
  if (dataIdx < 0 || dataIdx >= rows.length) {
    return { xml, ok: false };
  }
  const dataRow = rows[dataIdx];
  const nCells = (dataRow.match(/<w:tc/g) || []).length;
  const desired = [
    "{#items}{index}",
    "{tagNo}",
    "{name}",
    "{spec}",
    "{unit}",
    "{quantity}",
    "{deliveryDays}",
    "{unitPrice}",
    "{totalPrice}",
    "{remark}{/items}",
  ];
  const cellTexts = desired.slice(0, Math.max(nCells, 1));
  while (cellTexts.length < nCells) cellTexts.push("");
  const newRow = patchDataRowWithPlaceholders(dataRow, cellTexts);
  let newTable = tableXml.replace(dataRow, newRow);
  newTable = removeRowsContainingTokenInTable(newTable, ["2", "3", "4", "5"]);
  return { xml: xml.slice(0, start) + newTable + xml.slice(end), ok: true };
}

function patchPriceTablePreserve(xml) {
  const marker = "<w:t>单价(元)</w:t>";
  const markerIndex = xml.lastIndexOf(marker);
  if (markerIndex === -1) return xml;

  const tableStart = xml.lastIndexOf("<w:tbl", markerIndex);
  const tableEnd = xml.indexOf("</w:tbl>", markerIndex) + "</w:tbl>".length;
  if (tableStart === -1 || tableEnd === -1) return xml;

  const before = xml.slice(0, tableStart);
  const table = xml.slice(tableStart, tableEnd);
  const after = xml.slice(tableEnd);
  const rows = table.match(/<w:tr[\s\S]*?<\/w:tr>/g);
  if (!rows || rows.length < 2) return xml;

  const priceTexts = ["{#priceItems}{name}", "{spec}", "{unitPrice}", "", "{remark}{/priceItems}"];
  const dataRow = rows[1];
  const nCells = (dataRow.match(/<w:tc/g) || []).length;
  const cellTexts = priceTexts.slice(0, Math.max(nCells, 1));
  while (cellTexts.length < nCells) cellTexts.push("");
  const newRow = patchDataRowWithPlaceholders(dataRow, cellTexts);
  let patched = table.replace(rows[1], newRow);
  for (const row of rows.slice(2)) {
    patched = patched.replace(row, "");
  }
  return before + patched + after;
}

function patchAnnualTablesLegacy(xml) {
  const orderRow = tableRow([
    "{#items}{index}",
    "{tagNo}",
    "{name}",
    "{spec}",
    "{unit}",
    "{quantity}",
    "{deliveryDays}",
    "{unitPrice}",
    "{totalPrice}",
    "{remark}{/items}",
  ]);
  const priceRow = tableRow([
    "{#priceItems}{name}",
    "{spec}",
    "{unitPrice}",
    "",
    "{remark}{/priceItems}",
  ]);
  xml = replaceRowContaining(xml, "1", orderRow);
  xml = removeRowsContaining(xml, ["2", "3", "4", "5"]);
  return patchPriceTableLegacy(xml, priceRow);
}

function patchPriceTableLegacy(xml, priceRow) {
  const marker = "<w:t>单价(元)</w:t>";
  const markerIndex = xml.lastIndexOf(marker);
  if (markerIndex === -1) return xml;

  const tableStart = xml.lastIndexOf("<w:tbl", markerIndex);
  const tableEnd = xml.indexOf("</w:tbl>", markerIndex) + "</w:tbl>".length;
  if (tableStart === -1 || tableEnd === -1) return xml;

  const before = xml.slice(0, tableStart);
  const table = xml.slice(tableStart, tableEnd);
  const after = xml.slice(tableEnd);
  const rows = table.match(/<w:tr[\s\S]*?<\/w:tr>/g);
  if (!rows || rows.length < 2) return xml;

  let patched = table.replace(rows[1], priceRow);
  for (const row of rows.slice(2)) {
    patched = patched.replace(row, "");
  }
  return before + patched + after;
}

function patchAnnualTablesPreserve(xml) {
  const r = patchAnnualOrderTablePreserve(xml);
  if (!r.ok) {
    console.warn("[prepare-templates] annual order preserve failed, using legacy annual patch");
    return patchAnnualTablesLegacy(xml);
  }
  return patchPriceTablePreserve(r.xml);
}

function processDocx(inputName, outputName, patcher) {
  const inputPath = path.join(docxDir, inputName);
  const outputPath = path.join(placeholderDir, outputName);
  const zip = new PizZip(readFileSync(inputPath, "binary"));
  const documentPath = "word/document.xml";
  let xml = zip.file(documentPath).asText();
  xml = replaceText(xml);
  xml = patcher ? patcher(xml) : xml;
  zip.file(documentPath, xml);
  writeFileSync(outputPath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

function main() {
  ensureDirs();
  extractArchive();

  for (const [outputName, sourceName] of Object.entries(sourceFiles)) {
    if (sourceName.endsWith(".docx")) {
      copyDocx(sourceName, outputName);
    } else {
      convertDocToDocx(sourceName, outputName);
    }
  }

  processDocx("general-equipment.docx", "general-equipment.docx", patchEquipmentTablePreserve);
  processDocx("non-standard-no-install.docx", "non-standard-no-install.docx", patchEquipmentTablePreserve);
  processDocx("non-standard-with-install.docx", "non-standard-with-install.docx", patchEquipmentTablePreserve);
  processDocx("annual-framework.docx", "annual-framework.docx", patchAnnualTablesPreserve);
  processDocx("professional-subcontract.docx", "professional-subcontract.docx", null);
  processDocx("labor-subcontract.docx", "labor-subcontract.docx", null);

  console.log("Prepared placeholder templates in", placeholderDir);
}

main();
