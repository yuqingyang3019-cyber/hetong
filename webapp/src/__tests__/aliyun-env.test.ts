import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { requireEnv } from "@/lib/aliyun-env";

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
