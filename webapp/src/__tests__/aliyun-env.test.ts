import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDashScopeConfig, requireEnv } from "@/lib/aliyun-env";

describe("requireEnv", () => {
  beforeEach(() => {
    vi.stubEnv("TEST_ENV_VAR", "ok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns trimmed value", () => {
    expect(requireEnv("TEST_ENV_VAR")).toBe("ok");
  });

  it("throws when missing", () => {
    vi.stubEnv("TEST_ENV_VAR", "");
    expect(() => requireEnv("TEST_ENV_VAR")).toThrow(/缺少环境变量/);
  });
});

describe("getDashScopeConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires an explicit model", () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "test-key");
    vi.stubEnv("DASHSCOPE_MODEL", "");

    expect(() => getDashScopeConfig()).toThrow(/缺少环境变量 DASHSCOPE_MODEL/);
  });
});
