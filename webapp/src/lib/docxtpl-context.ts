import type { TemplateConfig } from "./template-config";
import { loadContractPlaceholderSchema } from "./contract-schema";

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function pendingMarker(label: string): string {
  return `【待填写：${label}】`;
}

function stringifyValue(value: unknown, label: string): string {
  if (isMissing(value)) return pendingMarker(label);
  return String(value);
}

/**
 * 将合并后的 renderData 转为 docxtpl 渲染上下文（扁平标量 + 各表数组）。
 */
export function buildDocxtplContext(renderData: Record<string, unknown>, config: TemplateConfig): Record<string, unknown> {
  const schema = loadContractPlaceholderSchema(config.type);
  const scalarLabels = Object.fromEntries(schema.scalars.map((field) => [field.key, field.label]));
  const context: Record<string, unknown> = {};
  for (const key of config.llmScalarPaths) {
    context[key] = stringifyValue(renderData[key], scalarLabels[key] ?? key);
  }

  for (const [tableName, columns] of Object.entries(config.tableBindings)) {
    const tableDef = schema.tables[tableName];
    const colLabels = Object.fromEntries((tableDef?.columns ?? []).map((column) => [column.key, column.label]));
    const rawRows = renderData[tableName];
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const mapped = rows.map((row) => {
      const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const out: Record<string, string> = {};
      for (const col of columns) {
        out[col] = stringifyValue(r[col], colLabels[col] ?? col);
      }
      return out;
    });
    context[tableName] = mapped;
  }

  return context;
}
