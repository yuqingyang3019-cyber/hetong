import { Readable } from "node:stream";
import OCRClient, { RecognizeAllTextRequest, RecognizeAllTextRequestAdvancedConfig } from "@alicloud/ocr-api20210707";
import { Config } from "@alicloud/openapi-core/dist/utils";
import { appLog } from "./app-log";
import { getOcrRecognizeAllTextConfig } from "./aliyun-env";

type RecognizeAllTextResponseBodyData = {
  content?: string;
  pageNo?: number;
  subImages?: Array<{
    paragraphInfo?: {
      paragraphDetails?: Array<{ paragraphContent?: string }>;
    };
    rowInfo?: {
      rowDetails?: Array<{ rowContent?: string }>;
    };
    tableInfo?: {
      tableCount?: number;
      tableDetails?: OcrTableDetail[];
    };
  }>;
};

type OcrTableDetail = {
  tableId?: number;
  rowCount?: number;
  columnCount?: number;
  cellDetails?: Array<{
    cellContent?: string;
    rowStart?: number;
    rowEnd?: number;
    columnStart?: number;
    columnEnd?: number;
  }>;
};

const MAX_OCR_BODY_BYTES = 10 * 1024 * 1024;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizeCell(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r/g, "\n").trim() : "";
}

function tableToRows(table: OcrTableDetail): string[][] {
  const rowCount = Math.max(
    table.rowCount ?? 0,
    ...((table.cellDetails ?? []).map((cell) => (cell.rowEnd ?? cell.rowStart ?? 0) + 1)),
  );
  const columnCount = Math.max(
    table.columnCount ?? 0,
    ...((table.cellDetails ?? []).map((cell) => (cell.columnEnd ?? cell.columnStart ?? 0) + 1)),
  );
  if (!rowCount || !columnCount) return [];

  const rows = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
  for (const cell of table.cellDetails ?? []) {
    const row = cell.rowStart ?? 0;
    const col = cell.columnStart ?? 0;
    if (rows[row]?.[col] !== undefined) {
      rows[row][col] = normalizeCell(cell.cellContent);
    }
  }
  return rows;
}

function rowsToHtml(rows: string[][], subImageIndex: number, tableIndex: number): string {
  const lines = [`<table subImage="${subImageIndex + 1}" index="${tableIndex + 1}">`];
  for (const row of rows) {
    lines.push("  <tr>");
    for (const cell of row) {
      lines.push(`    <td>${escapeHtml(cell).replace(/\n/g, "<br>")}</td>`);
    }
    lines.push("  </tr>");
  }
  lines.push("</table>");
  return lines.join("\n");
}

function rowsToTsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => cell.replace(/\n/g, " / ")).join("\t")).join("\n");
}

export function flattenOcrText(data: RecognizeAllTextResponseBodyData): string {
  const parts: string[] = [];
  const subs = data.subImages ?? [];
  subs.forEach((sub, index) => {
    const tables = sub.tableInfo?.tableDetails ?? [];
    tables.forEach((table, tableIndex) => {
      const rows = tableToRows(table);
      if (!rows.length) return;
      parts.push(`[表格 parser=aliyun-ocr subImage=${index + 1} index=${tableIndex + 1}]`);
      parts.push(rowsToHtml(rows, index, tableIndex));
      parts.push("[TSV]");
      parts.push(rowsToTsv(rows));
    });

    const rowLines = (sub.rowInfo?.rowDetails ?? []).map((d) => d.rowContent?.trim()).filter(Boolean) as string[];
    if (rowLines.length) {
      parts.push(`--- 子图 ${index + 1} 行文本 ---\n${rowLines.join("\n")}`);
    }

    const details = sub.paragraphInfo?.paragraphDetails ?? [];
    const lines = details.map((d) => d.paragraphContent?.trim()).filter(Boolean) as string[];
    if (lines.length) {
      parts.push(`--- 子图 ${index + 1} 段落 ---\n${lines.join("\n")}`);
    }
  });

  const content = data.content?.trim();
  if (content) {
    parts.push("[全文]");
    parts.push(content);
  }

  const text = parts.join("\n").trim();
  if (!text) {
    throw new Error("阿里云 OCR 返回结果中未解析到任何文本内容");
  }
  return text;
}

/**
 * 对 PDF/图片等二进制调用 RecognizeAllText；纯文本文件不应走此函数。
 */
export async function recognizeAllTextFromBuffer(buffer: Buffer) {
  if (buffer.length > MAX_OCR_BODY_BYTES) {
    throw new Error("阿里云 OCR body 最大支持 10MB，请压缩图片或拆分文件后重试");
  }
  const ocr = getOcrRecognizeAllTextConfig();
  appLog.info("ocr-aliyun", "RecognizeAllText request", {
    endpoint: ocr.endpoint,
    type: ocr.type,
    outputTable: ocr.type === "Advanced" ? ocr.outputTable : undefined,
    isLineLessTable: ocr.type === "Advanced" && ocr.outputTable ? ocr.isLineLessTable : undefined,
    byteLength: buffer.length,
  });
  const config = new Config({
    accessKeyId: ocr.accessKeyId,
    accessKeySecret: ocr.accessKeySecret,
    endpoint: ocr.endpoint,
    regionId: ocr.regionId,
  });
  const client = new OCRClient(config);
  const request = new RecognizeAllTextRequest({
    type: ocr.type,
    body: Readable.from(buffer),
    ...(ocr.type === "Advanced"
      ? {
          advancedConfig: new RecognizeAllTextRequestAdvancedConfig({
            outputTable: ocr.outputTable,
            outputRow: true,
            outputParagraph: true,
            isLineLessTable: ocr.isLineLessTable,
            outputTableExcel: false,
            outputTableHtml: false,
          }),
        }
      : {}),
  });
  let response;
  try {
    response = await client.recognizeAllText(request);
  } catch (error) {
    appLog.error("ocr-aliyun", "RecognizeAllText network/SDK error", error);
    throw error;
  }
  const body = response.body;
  if (!body) {
    throw new Error("阿里云 OCR 响应体为空");
  }
  if (body.code != null && body.code !== "" && String(body.code) !== "200" && body.code !== "OK") {
    appLog.error("ocr-aliyun", "RecognizeAllText business error", undefined, {
      code: body.code,
      message: body.message,
    });
    throw new Error(`阿里云 OCR 失败：${body.code} ${body.message ?? ""}`.trim());
  }
  if (!body.data) {
    appLog.error("ocr-aliyun", "RecognizeAllText no data", undefined, { message: body.message });
    throw new Error(`阿里云 OCR 无 data：${body.message ?? "unknown"}`);
  }
  const data = body.data as RecognizeAllTextResponseBodyData;
  const text = flattenOcrText(data);
  appLog.info("ocr-aliyun", "RecognizeAllText ok", {
    textLength: text.length,
    subImageCount: data.subImages?.length ?? 0,
    tableCount: (data.subImages ?? []).reduce((sum, sub) => sum + (sub.tableInfo?.tableCount ?? sub.tableInfo?.tableDetails?.length ?? 0), 0),
  });
  return text;
}
