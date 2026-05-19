import { appendFile, mkdir } from "fs/promises";
import path from "path";

export type LogMeta = Record<string, unknown>;

function timestamp() {
  return new Date().toISOString();
}

function serializeMeta(meta?: LogMeta): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [meta_unserializable]";
  }
}

function formatLine(level: string, scope: string, message: string, meta?: LogMeta): string {
  return `${timestamp()} [contract-app] [${level}] [${scope}] ${message}${serializeMeta(meta)}`;
}

async function appendToFileIfConfigured(line: string): Promise<void> {
  const dir = process.env.CONTRACT_APP_LOG_DIR?.trim();
  if (!dir) return;
  try {
    const logDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    const day = new Date().toISOString().slice(0, 10);
    const filePath = path.join(logDir, `contract-app-${day}.log`);
    await mkdir(logDir, { recursive: true });
    await appendFile(filePath, line + "\n", "utf8");
  } catch {
    // 文件日志失败不影响主流程
  }
}

function emitConsole(level: string, line: string): void {
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function emit(level: string, scope: string, message: string, meta?: LogMeta): void {
  const line = formatLine(level, scope, message, meta);
  emitConsole(level, line);
  void appendToFileIfConfigured(line);
}

/**
 * 应用级日志：开发时看运行 `npm run dev` 的终端；可选设置 CONTRACT_APP_LOG_DIR 追加写入按日文件。
 * 禁止传入密钥、Cookie 等敏感凭证。调试 LLM 时可显式记录用户确认后的报价文本。
 */
export const appLog = {
  info(scope: string, message: string, meta?: LogMeta) {
    emit("INFO", scope, message, meta);
  },
  warn(scope: string, message: string, meta?: LogMeta) {
    emit("WARN", scope, message, meta);
  },
  error(scope: string, message: string, error?: unknown, meta?: LogMeta) {
    const errMsg = error instanceof Error ? error.message : error !== undefined ? String(error) : "";
    const merged: LogMeta = { ...meta };
    if (errMsg) merged.errorMessage = errMsg;
    emit("ERROR", scope, message, merged);
    if (error instanceof Error && error.stack) {
      const stackLine = `${timestamp()} [contract-app] [ERROR] [${scope}] stack${serializeMeta({ stack: error.stack })}`;
      console.error(stackLine);
      void appendToFileIfConfigured(stackLine);
    }
  },
};
