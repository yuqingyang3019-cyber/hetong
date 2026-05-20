/** 读取必需环境变量；缺失时抛出明确错误，不做静默降级。 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return String(value).trim();
}

/** 百炼 DashScope OpenAI-compatible */
export function getDashScopeConfig() {
  return {
    apiKey: requireEnv("DASHSCOPE_API_KEY"),
    baseURL:
      process.env.DASHSCOPE_BASE_URL?.trim() ||
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: requireEnv("DASHSCOPE_MODEL"),
    enableThinking: process.env.DASHSCOPE_ENABLE_THINKING !== "false",
  };
}

/** 文字识别 OCR（RecognizeAllText） */
export function getOcrRecognizeAllTextConfig() {
  const scene = process.env.ALIYUN_OCR_SCENE?.trim() || "Advanced";
  return {
    accessKeyId: requireEnv("ALIYUN_ACCESS_KEY_ID"),
    accessKeySecret: requireEnv("ALIYUN_ACCESS_KEY_SECRET"),
    endpoint: process.env.ALIYUN_OCR_ENDPOINT?.trim() || "ocr-api.cn-hangzhou.aliyuncs.com",
    regionId: process.env.ALIYUN_OCR_REGION_ID?.trim() || "cn-hangzhou",
    /** API 的 Type 参数，如 General、Advanced */
    type: normalizeOcrType(scene),
    outputTable: envBool("ALIYUN_OCR_OUTPUT_TABLE", true),
    isLineLessTable: envBool("ALIYUN_OCR_LINELESS_TABLE", false),
  };
}

function normalizeOcrType(scene: string) {
  const s = scene.trim();
  if (!s) throw new Error("ALIYUN_OCR_SCENE 不能为空");
  if (/^[A-Z]/.test(s)) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function envBool(name: string, defaultValue: boolean) {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}
