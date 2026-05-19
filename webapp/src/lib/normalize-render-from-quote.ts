import type { TemplateConfig } from "./template-config";

function parseAmount(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  const t = String(value).replace(/[,\s￥¥元]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function numCell(value: unknown): number | null {
  const n = parseAmount(value);
  return Number.isFinite(n) ? n : null;
}

/** 从报价行末尾抓取金额（支持 750、750元、1,200.5） */
function extractTrailingAmount(line: string): number | null {
  const compact = line.replace(/[,，]/g, "").trim();
  const m = compact.match(/(\d+(?:\.\d+)?)\s*(?:元)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function findLineContaining(lines: string[], keyword: string): string | undefined {
  return lines.find((l) => l.includes(keyword));
}

type ItemRow = Record<string, string>;

function isEquipmentWithTagNo(config: TemplateConfig): boolean {
  return Boolean(config.tableBindings.items?.includes("tagNo"));
}

/**
 * 针对「单行总价 = 主设备 + 法兰 + 液位计」类报价（如浙东），在合并 LLM 结果后拆成多行，
 * 避免小计误入主设备行；可选追加运费行。
 */
export function normalizeRenderDataFromQuote(
  renderData: Record<string, unknown>,
  quoteText: string,
  config: TemplateConfig,
): { renderData: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const out: Record<string, unknown> = { ...renderData };

  if (!isEquipmentWithTagNo(config)) {
    return { renderData: out, warnings };
  }

  const items = out.items;
  if (!Array.isArray(items) || items.length !== 1) {
    return { renderData: out, warnings };
  }

  const quote = quoteText.trim();
  if (quote.length < 8) {
    return { renderData: out, warnings };
  }

  const lines = quote.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => l.includes("法兰")) || !lines.some((l) => (l.includes("液位计") || l.includes("四氟")))) {
    return { renderData: out, warnings };
  }

  const row = items[0] as ItemRow;
  const qty = numCell(row.quantity) ?? 1;
  const unitPrice = numCell(row.unitPrice);
  const totalPrice = numCell(row.totalPrice);

  if (unitPrice === null || totalPrice === null) {
    return { renderData: out, warnings };
  }

  const flangeLine = findLineContaining(lines, "法兰");
  const gaugeLine = findLineContaining(lines, "液位计") ?? findLineContaining(lines, "四氟");
  const shipLine = findLineContaining(lines, "运费");

  const flangeAmt = flangeLine ? extractTrailingAmount(flangeLine) : null;
  const gaugeAmt = gaugeLine ? extractTrailingAmount(gaugeLine) : null;

  if (
    flangeAmt === null ||
    gaugeAmt === null ||
    !Number.isFinite(flangeAmt) ||
    !Number.isFinite(gaugeAmt)
  ) {
    return { renderData: out, warnings };
  }

  const mainLineTotal = unitPrice * qty;
  const subSum = mainLineTotal + flangeAmt + gaugeAmt;

  if (Math.abs(totalPrice - subSum) > 2) {
    warnings.push(
      `报价明细金额未按「主设备+法兰+液位计」小计拆分：单行总价 ${totalPrice}，推算小计 ${subSum}（主 ${mainLineTotal}+法兰 ${flangeAmt}+液位 ${gaugeAmt}），请人工核对。`,
    );
    return { renderData: out, warnings };
  }

  let shipAmt: number = NaN;
  const fromLine = shipLine ? extractTrailingAmount(shipLine) : null;
  if (fromLine !== null && Number.isFinite(fromLine)) {
    shipAmt = fromLine;
  } else {
    const fromField = parseAmount(out.shippingFee);
    if (Number.isFinite(fromField)) {
      shipAmt = fromField;
    }
  }

  const totalAll = numCell(out.totalAmount);
  if (totalAll !== null && Number.isFinite(shipAmt) && Math.abs(subSum + shipAmt - totalAll) > 2) {
    warnings.push(
      `小计 ${subSum} 与运费、合同总价关系不完全一致（总价 ${totalAll}，运费按报价解析为 ${shipAmt}），请人工核对。`,
    );
  }

  const tag = row.tagNo ?? "";

  const newItems: ItemRow[] = [
    {
      ...row,
      index: row.index || "1",
      quantity: String(qty),
      unitPrice: String(unitPrice),
      totalPrice: String(mainLineTotal),
    },
    {
      index: "2",
      name: "法兰",
      spec: flangeLine ?? "",
      unit: "",
      quantity: "",
      unitPrice: "",
      totalPrice: String(flangeAmt),
      tagNo: tag,
    },
    {
      index: "3",
      name: "液位计",
      spec: gaugeLine ?? "",
      unit: "",
      quantity: "",
      unitPrice: "",
      totalPrice: String(gaugeAmt),
      tagNo: "",
    },
  ];

  if (Number.isFinite(shipAmt) && shipAmt > 0) {
    newItems.push({
      index: String(newItems.length + 1),
      name: "运费",
      spec: shipLine ?? "",
      unit: "",
      quantity: "",
      unitPrice: "",
      totalPrice: String(shipAmt),
      tagNo: "",
    });
  }

  out.items = newItems;
  warnings.push(
    `已根据报价原文将主设备行拆分为：主设备（${mainLineTotal}）、法兰（${flangeAmt}）、液位计（${gaugeAmt}）` +
      (Number.isFinite(shipAmt) && shipAmt > 0 ? `、运费（${shipAmt}）` : "") +
      "。",
  );

  return { renderData: out, warnings };
}
