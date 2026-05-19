import { readFile } from "fs/promises";
import pdfParse from "pdf-parse";
import { appLog } from "./app-log";
import { recognizeAllTextFromBuffer } from "./ocr-aliyun";
import { extractPythonExcelTextFromFile } from "./excel-python-text";
import { extractLayoutTextFromPdfBuffer } from "./pdf-layout-text";
import { extractPythonPdfTextFromFile } from "./pdf-python-text";

/**
 * 报价单文本：纯文本直接读取；PDF/Excel 优先本地结构化解析；图片等二进制再走阿里云 OCR。
 */
export async function extractTextFromFile(filePath: string, mimeType: string) {
  const buffer = await readFile(filePath);
  const lower = filePath.toLowerCase();

  if (mimeType.startsWith("text/") || lower.endsWith(".txt")) {
    const text = buffer.toString("utf8").trim();
    if (!text) {
      appLog.warn("extract-text", "text file empty", { mimeType, pathSuffix: filePath.slice(-40) });
      throw new Error("文本报价单内容为空");
    }
    appLog.info("extract-text", "branch: utf8 text file", { mimeType, textLength: text.length });
    return text;
  }

  if (isExcelFile(lower, mimeType)) {
    const excelResult = await extractPythonExcelTextFromFile(filePath);
    if (!excelResult.text) {
      appLog.warn("extract-text", "excel returned no text", {
        mimeType,
        sheetCount: excelResult.sheetCount,
        errors: excelResult.errors,
      });
      throw new Error(excelResult.errors[0] ?? "Excel 报价单内容为空");
    }
    appLog.info("extract-text", "branch: excel python structured table", {
      mimeType,
      sheetCount: excelResult.sheetCount,
      tableCount: excelResult.tableCount,
      rowCount: excelResult.rowCount,
      textLength: excelResult.text.length,
    });
    return excelResult.text;
  }

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    try {
      const pythonResult = await extractPythonPdfTextFromFile(filePath);
      if (pythonResult.text) {
        appLog.info("extract-text", "branch: pdf python pdfplumber", {
          mimeType,
          pageCount: pythonResult.pageCount,
          lineCount: pythonResult.lineCount,
          tableCount: pythonResult.tableCount,
          textLength: pythonResult.text.length,
          errors: pythonResult.errors,
        });
        return pythonResult.text;
      }
      if (pythonResult.errors.length) {
        appLog.warn("extract-text", "pdfplumber returned no text", {
          mimeType,
          errors: pythonResult.errors,
        });
      }
    } catch (error) {
      appLog.warn("extract-text", "pdfplumber unavailable, fallback pdf-parse", {
        mimeType,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    const layoutResult = await extractLayoutTextFromPdfBuffer(buffer);
    if (layoutResult.text) {
      appLog.info("extract-text", "branch: pdf layout text layer", {
        mimeType,
        pageCount: layoutResult.pageCount,
        lineCount: layoutResult.lineCount,
        textLength: layoutResult.text.length,
      });
      return layoutResult.text;
    }

    const result = await pdfParse(buffer);
    const text = result.text.trim();
    if (text) {
      appLog.info("extract-text", "branch: pdf text layer", {
        mimeType,
        pageCount: result.numpages,
        textLength: text.length,
      });
      return text;
    }
    appLog.warn("extract-text", "pdf text layer empty, fallback OCR", { mimeType, byteLength: buffer.length });
  } else {
    appLog.info("extract-text", "branch: OCR (non-pdf-text)", { mimeType, byteLength: buffer.length });
  }

  return recognizeAllTextFromBuffer(buffer);
}

function isExcelFile(lowerPath: string, mimeType: string) {
  const lowerMime = mimeType.toLowerCase();
  return (
    lowerPath.endsWith(".xlsx") ||
    lowerPath.endsWith(".xls") ||
    lowerMime.includes("spreadsheetml") ||
    lowerMime.includes("ms-excel")
  );
}
