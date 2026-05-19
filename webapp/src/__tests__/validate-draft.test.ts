import { describe, expect, it } from "vitest";
import { templateConfigs } from "@/lib/template-config";
import { mergeLlmPatchIntoRenderData } from "@/lib/merge-render-data";
import { validateDraft } from "@/lib/validate-draft";

describe("validateDraft", () => {
  it("marks missing required fields", () => {
    const render = mergeLlmPatchIntoRenderData({}, templateConfigs.caigouhetong);
    const result = validateDraft(render, templateConfigs.caigouhetong);
    expect(result.missingFields).toContain("items");
    expect(result.missingFields).not.toContain("supplier.name");
  });

  it("checks line totals and aggregate totals", () => {
    const extracted: Record<string, unknown> = {
      supplierName: "供应商",
      totalAmountChinese: "壹佰元整",
      items: [
        {
          index: "1",
          name: "x",
          spec: "",
          unit: "",
          quantity: "2",
          unitPrice: "30",
          totalPrice: "70",
          remark: "",
        },
      ],
    };
    const render = mergeLlmPatchIntoRenderData(extracted, templateConfigs.caigouhetong);
    const result = validateDraft(render, templateConfigs.caigouhetong);
    expect(result.warnings.some((warning) => warning.includes("金额校验不一致"))).toBe(true);
  });
});
