import { describe, expect, it } from "vitest";
import { templateConfigs } from "@/lib/template-config";
import { mergeLlmPatchIntoRenderData } from "@/lib/merge-render-data";
import { normalizeRenderDataFromQuote } from "@/lib/normalize-render-from-quote";

describe("normalizeRenderDataFromQuote", () => {
  it("does not split Zhedong-style rows when template has no tagNo column", () => {
    const quote = ["设备 清水箱", "法兰配套 750", "液位计四氟 550", "运费 500"].join("\n");

    const extracted: Record<string, unknown> = {
      supplierName: "浙东公司",
      totalAmountChinese: "叁仟陆佰元整",
      items: [
        {
          index: "1",
          name: "PE 清水箱",
          spec: "含配套",
          unit: "台",
          quantity: "1",
          unitPrice: "1800",
          totalPrice: "3100",
          remark: "",
        },
      ],
    };

    const merged = mergeLlmPatchIntoRenderData(extracted, templateConfigs.caigouhetong);
    const { renderData, warnings } = normalizeRenderDataFromQuote(merged, quote, templateConfigs.caigouhetong);

    expect(warnings.filter((w) => w.includes("已根据报价原文"))).toHaveLength(0);
    const items = renderData.items as Record<string, string>[];
    expect(items).toHaveLength(1);
    expect(items[0].totalPrice).toBe("3100");
  });

  it("returns unchanged renderData when quote lacks Zhedong-style keywords", () => {
    const quote = "普通报价文本";
    const extracted: Record<string, unknown> = {
      items: [
        {
          index: "1",
          name: "设备",
          spec: "",
          unit: "台",
          quantity: "1",
          unitPrice: "100",
          totalPrice: "100",
          remark: "",
        },
      ],
    };
    const merged = mergeLlmPatchIntoRenderData(extracted, templateConfigs.caigouhetong);
    const { renderData, warnings } = normalizeRenderDataFromQuote(merged, quote, templateConfigs.caigouhetong);
    expect((renderData.items as unknown[]).length).toBe(1);
    expect(warnings).toHaveLength(0);
  });
});

describe("mergeLlmPatchIntoRenderData", () => {
  it("leaves buyer empty when LLM omits buyer and template has no defaultFields buyer", () => {
    const render = mergeLlmPatchIntoRenderData({}, templateConfigs.caigouhetong);
    const buyer = render.buyer as Record<string, string>;
    expect(buyer.name).toBe("");
    expect(buyer.bank).toBe("");
  });
});
