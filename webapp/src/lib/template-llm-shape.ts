import type { TemplateConfig } from "./template-config";

function setByDotPath(target: Record<string, unknown>, dotPath: string, value: unknown) {
  const parts = dotPath.split(".");
  let current: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = current[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function emptyItemRow(columns: string[]) {
  return Object.fromEntries(columns.map((key) => [key, null])) as Record<string, string | number | null>;
}

/**
 * 供 LLM 填空的 JSON 形状：仅包含当前模板 `llmScalarPaths` 与 `tableBindings` 中的键；
 * 标量用 null，表格用两行 null 列示例，强调 LLM 应按报价单实际计价项输出多行。
 */
export function buildLlmOutputShape(config: TemplateConfig): Record<string, unknown> {
  const shape: Record<string, unknown> = {};

  for (const path of config.llmScalarPaths) {
    setByDotPath(shape, path, null);
  }

  for (const [tableName, columns] of Object.entries(config.tableBindings)) {
    shape[tableName] = [emptyItemRow(columns), emptyItemRow(columns)];
  }

  return shape;
}
