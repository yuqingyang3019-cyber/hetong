import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeLlmPatchIntoRenderData } from "@/lib/merge-render-data";
import { templateConfigs } from "@/lib/template-config";

describe("mergeLlmPatchIntoRenderData date defaults", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fills empty signing and signature date parts from Asia/Shanghai today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T01:00:00.000Z"));

    const render = mergeLlmPatchIntoRenderData({}, templateConfigs.caigouhetong);

    expect(render.signYear).toBe("2026");
    expect(render.signMonth).toBe("05");
    expect(render.signDay).toBe("16");
    expect(render.signatureYear).toBe("2026");
    expect(render.signatureMonth).toBe("05");
    expect(render.signatureDay).toBe("16");
  });

  it("does not overwrite provided date parts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T01:00:00.000Z"));

    const render = mergeLlmPatchIntoRenderData(
      {
        signYear: "2025",
        signMonth: "12",
        signDay: "31",
        signatureYear: "2024",
        signatureMonth: "01",
        signatureDay: "02",
      },
      templateConfigs.caigouhetong,
    );

    expect(render.signYear).toBe("2025");
    expect(render.signMonth).toBe("12");
    expect(render.signDay).toBe("31");
    expect(render.signatureYear).toBe("2024");
    expect(render.signatureMonth).toBe("01");
    expect(render.signatureDay).toBe("02");
  });
});
