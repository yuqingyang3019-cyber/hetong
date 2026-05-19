import { spawn } from "child_process";
import path from "path";

export type PdfPythonTextResult = {
  text: string;
  pageCount: number;
  lineCount: number;
  tableCount: number;
  errors: string[];
};

type PdfPlumberPayload = {
  text?: unknown;
  page_count?: unknown;
  line_count?: unknown;
  table_count?: unknown;
  errors?: unknown;
};

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizePayload(payload: PdfPlumberPayload): PdfPythonTextResult {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  return {
    text,
    pageCount: toNumber(payload.page_count),
    lineCount: toNumber(payload.line_count),
    tableCount: toNumber(payload.table_count),
    errors: toStringArray(payload.errors),
  };
}

/**
 * 使用 Python pdfplumber 优先还原 PDF 中的有线框/复杂表格。
 * 依赖缺失或脚本失败时由调用方回退到 JS 文本层解析。
 */
export function extractPythonPdfTextFromFile(filePath: string): Promise<PdfPythonTextResult> {
  const scriptPath = path.join(process.cwd(), "scripts", "pdfplumber-extract.py");
  const pythonBin = process.env.PDFPLUMBER_PYTHON?.trim() || process.env.PYTHON?.trim() || "python3";

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath, filePath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(stderr || `pdfplumber exited with code ${code}`));
        return;
      }

      try {
        resolve(normalizePayload(JSON.parse(stdout) as PdfPlumberPayload));
      } catch (error) {
        reject(new Error(`pdfplumber 输出不是有效 JSON：${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}
