import { readFileSync, existsSync } from "fs";
import PizZip from "pizzip";
import type { TemplateType } from "./types";
import { getContractPlaceholderSchemaPath, getContractTemplateDocxPath } from "./paths";

export type ContractScalarField = {
  key: string;
  label: string;
};

export type ContractTableColumn = {
  key: string;
  label: string;
};

export type ContractPlaceholderSchema = {
  template: {
    id: string;
    engine: string;
    syntax: string;
    docx: string;
  };
  scalars: ContractScalarField[];
  tables: Record<
    string,
    {
      label: string;
      columns: ContractTableColumn[];
    }
  >;
};

const schemaCache = new Map<TemplateType, ContractPlaceholderSchema>();

export function loadContractPlaceholderSchema(templateType: TemplateType): ContractPlaceholderSchema {
  const cached = schemaCache.get(templateType);
  if (cached) return cached;
  const schemaPath = getContractPlaceholderSchemaPath(templateType);
  if (!existsSync(schemaPath)) {
    throw new Error(`合同字段契约 JSON 不存在：${schemaPath}`);
  }
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as ContractPlaceholderSchema;
  schemaCache.set(templateType, schema);
  return schema;
}

export function clearContractSchemaCache() {
  schemaCache.clear();
}

/**
 * 校验 docx 中出现的 Jinja 变量与 JSON 契约一致（标量名、各表列名）。
 */
export function assertDocxSchemaAlignment(templateType: TemplateType): void {
  const schema = loadContractPlaceholderSchema(templateType);
  const docxPath = getContractTemplateDocxPath(templateType);
  if (!existsSync(docxPath)) {
    throw new Error(`合同模板 docx 不存在：${docxPath}`);
  }
  const zip = new PizZip(readFileSync(docxPath, "binary"));
  const file = zip.file("word/document.xml");
  if (!file) {
    throw new Error("模板 docx 缺少 word/document.xml");
  }
  const xml = file.asText();

  const scalarKeys = new Set(schema.scalars.map((s) => s.key));
  const tableColumnKeys: Record<string, Set<string>> = {};
  for (const [tableName, def] of Object.entries(schema.tables)) {
    tableColumnKeys[tableName] = new Set(def.columns.map((c) => c.key));
  }

  const scalarsInDoc = new Set<string>();
  for (const match of xml.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) {
    scalarsInDoc.add(match[1]);
  }

  const itemColsInDoc = new Set<string>();
  for (const match of xml.matchAll(/\{\{\s*item\.([a-zA-Z0-9_]+)\s*\}\}/g)) {
    itemColsInDoc.add(match[1]);
    scalarsInDoc.delete(match[1]);
  }

  const priceItemColsInDoc = new Set<string>();
  for (const match of xml.matchAll(/\{\{\s*priceItem\.([a-zA-Z0-9_]+)\s*\}\}/g)) {
    priceItemColsInDoc.add(match[1]);
    scalarsInDoc.delete(match[1]);
  }

  const missingScalars = [...scalarsInDoc].filter((k) => !scalarKeys.has(k));
  if (missingScalars.length) {
    throw new Error(`docx 中出现未在 JSON scalars 声明的变量：${missingScalars.join(", ")}`);
  }

  if (schema.tables.items) {
    const itemKeys = tableColumnKeys.items ?? new Set();
    const missingItemCols = [...itemColsInDoc].filter((k) => !itemKeys.has(k));
    if (missingItemCols.length) {
      throw new Error(`docx 中出现未在 JSON tables.items 声明的列：${missingItemCols.join(", ")}`);
    }
    const unusedItemCols = [...itemKeys].filter((k) => !itemColsInDoc.has(k));
    if (unusedItemCols.length) {
      throw new Error(`JSON tables.items 中有 docx 未使用的列（请删除或写入模板）：${unusedItemCols.join(", ")}`);
    }
    if (!xml.includes("{% for item in items %}") || !xml.includes("{% endfor %}")) {
      throw new Error("模板缺少货物明细行循环：{% for item in items %} … {% endfor %}");
    }
  }

  if (schema.tables.priceItems) {
    const pKeys = tableColumnKeys.priceItems ?? new Set();
    const missingPriceCols = [...priceItemColsInDoc].filter((k) => !pKeys.has(k));
    if (missingPriceCols.length) {
      throw new Error(`docx 中出现未在 JSON tables.priceItems 声明的列：${missingPriceCols.join(", ")}`);
    }
    const unusedPriceCols = [...pKeys].filter((k) => !priceItemColsInDoc.has(k));
    if (unusedPriceCols.length) {
      throw new Error(`JSON tables.priceItems 中有 docx 未使用的列（请删除或写入模板）：${unusedPriceCols.join(", ")}`);
    }
    if (!xml.includes("{% for priceItem in priceItems %}") || !xml.includes("{% endfor %}")) {
      throw new Error("模板缺少协议价行循环：{% for priceItem in priceItems %} … {% endfor %}");
    }
  }

  const unusedScalars = [...scalarKeys].filter((k) => !scalarsInDoc.has(k));
  if (unusedScalars.length) {
    throw new Error(`JSON scalars 中有 docx 未使用的字段（请删除或写入模板）：${unusedScalars.join(", ")}`);
  }
}
