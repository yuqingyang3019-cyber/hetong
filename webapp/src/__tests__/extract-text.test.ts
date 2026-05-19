import { describe, expect, it, vi } from "vitest";

vi.mock("fs/promises", () => ({
  readFile: vi.fn(async () => Buffer.from("binary")),
}));

vi.mock("@/lib/excel-python-text", () => ({
  extractPythonExcelTextFromFile: vi.fn(async () => ({
    text: "--- 工作表：Sheet1 ---\n[TSV]\n品名\t数量",
    sheetCount: 1,
    tableCount: 1,
    rowCount: 2,
    errors: [],
  })),
}));

vi.mock("@/lib/ocr-aliyun", () => ({
  recognizeAllTextFromBuffer: vi.fn(async () => "OCR"),
}));

vi.mock("@/lib/pdf-python-text", () => ({
  extractPythonPdfTextFromFile: vi.fn(),
}));

vi.mock("@/lib/pdf-layout-text", () => ({
  extractLayoutTextFromPdfBuffer: vi.fn(),
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));

import { extractTextFromFile } from "@/lib/extract-text";
import { extractPythonExcelTextFromFile } from "@/lib/excel-python-text";
import { recognizeAllTextFromBuffer } from "@/lib/ocr-aliyun";

describe("extractTextFromFile", () => {
  it("routes Excel files to the structured Python extractor instead of OCR", async () => {
    const text = await extractTextFromFile("/tmp/报价单.xlsx", "application/octet-stream");

    expect(text).toContain("[TSV]");
    expect(extractPythonExcelTextFromFile).toHaveBeenCalledWith("/tmp/报价单.xlsx");
    expect(recognizeAllTextFromBuffer).not.toHaveBeenCalled();
  });
});
