import type { TemplateConfig } from "./template-config";

function getPathValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const record = obj as Record<string, unknown>;
  const flatMap: Record<string, string> = {
    "commercial.installPeriodDays": "installPeriodDays",
    "commercial.deliveryDays": "deliveryDays",
    "commercial.paymentTerms": "paymentTerms",
    "commercial.taxRate": "taxRate",
    "commercial.deliveryDateText": "deliveryDateText",
  };
  if (flatMap[path] && flatMap[path] in record) {
    return record[flatMap[path]];
  }
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, obj);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[,\s￥¥元]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function itemRowHasContent(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return Object.values(row as Record<string, unknown>).some((v) => {
    if (v === null || v === undefined) return false;
    return String(v).trim() !== "";
  });
}

/** 校验合并后的 renderData（占位符已展开为字符串/对象）。 */
export function validateDraft(renderData: Record<string, unknown>, config: TemplateConfig) {
  const missingFields: string[] = [];
  const warnings: string[] = [];

  for (const field of config.requiredFields) {
    if (field === "items" || field === "priceItems") {
      const rows = renderData[field];
      if (!Array.isArray(rows) || rows.length === 0 || !rows.some(itemRowHasContent)) {
        missingFields.push(field);
      }
      continue;
    }
    const value = getPathValue(renderData, field);
    if (value === null || value === undefined || value === "") {
      missingFields.push(field);
    }
  }

  const items = (renderData.items as Record<string, string>[] | undefined) ?? [];
  let lineTotalSum = 0;
  let hasLineTotals = false;
  for (const [index, row] of items.entries()) {
    const quantity = num(row.quantity);
    const unitPrice = num(row.unitPrice);
    const totalPrice = num(row.totalPrice);
    if (totalPrice !== null) {
      hasLineTotals = true;
      lineTotalSum += totalPrice;
    }
    if (quantity !== null && unitPrice !== null && totalPrice !== null) {
      const expected = quantity * unitPrice;
      if (Math.abs(expected - totalPrice) > 0.02) {
        warnings.push(`第 ${index + 1} 行金额校验不一致：数量 x 单价 = ${expected}，总价 = ${totalPrice}`);
      }
    }
  }

  const totalAmount = num(renderData.totalAmount);
  if (hasLineTotals && totalAmount !== null && Math.abs(lineTotalSum - totalAmount) > 0.02) {
    warnings.push(`明细合计 ${lineTotalSum} 与合同总价 ${totalAmount} 不一致`);
  }

  return {
    missingFields,
    warnings: Array.from(new Set(warnings)),
  };
}
