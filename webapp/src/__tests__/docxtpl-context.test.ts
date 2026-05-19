import { describe, expect, it } from "vitest";
import { buildDocxtplContext } from "@/lib/docxtpl-context";
import { templateConfigs } from "@/lib/template-config";

describe("buildDocxtplContext", () => {
  it("renders missing scalar and item values as visible pending markers", () => {
    const context = buildDocxtplContext(
      {
        contractNo: "",
        supplierName: "测试供应商",
        items: [
          {
            index: "1",
            name: "设备A",
            spec: null,
            unit: "",
            quantity: "2",
          },
        ],
      },
      templateConfigs.caigouhetong,
    );

    expect(context.contractNo).toBe("【待填写：合同编号】");
    expect(context.supplierName).toBe("测试供应商");
    expect((context.items as Record<string, string>[])[0].spec).toBe("【待填写：规格/型号/材质】");
    expect((context.items as Record<string, string>[])[0].unit).toBe("【待填写：单位】");
  });
});
