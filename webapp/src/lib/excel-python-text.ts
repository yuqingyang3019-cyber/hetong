import { spawn } from "child_process";
import path from "path";

export type ExcelPythonTextResult = {
  text: string;
  sheetCount: number;
  tableCount: number;
  rowCount: number;
  errors: string[];
};

type ExcelPayload = {
  text?: unknown;
  sheet_count?: unknown;
  table_count?: unknown;
  row_count?: unknown;
  errors?: unknown;
};

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizePayload(payload: ExcelPayload): ExcelPythonTextResult {
  return {
    text: typeof payload.text === "string" ? payload.text.trim() : "",
    sheetCount: toNumber(payload.sheet_count),
    tableCount: toNumber(payload.table_count),
    rowCount: toNumber(payload.row_count),
    errors: toStringArray(payload.errors),
  };
}

export function extractPythonExcelTextFromFile(filePath: string): Promise<ExcelPythonTextResult> {
  const scriptPath = path.join(process.cwd(), "scripts", "excel-extract.py");
  const pythonBin = process.env.EXCEL_EXTRACT_PYTHON?.trim() || process.env.PYTHON?.trim() || "python3";

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
        reject(new Error(stderr || `excel-extract exited with code ${code}`));
        return;
      }

      try {
        resolve(normalizePayload(JSON.parse(stdout) as ExcelPayload));
      } catch (error) {
        reject(new Error(`excel-extract 输出不是有效 JSON：${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}
