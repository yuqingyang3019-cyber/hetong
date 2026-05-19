import pdfParse from "pdf-parse";

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

type PdfTextContent = {
  items?: PdfTextItem[];
};

type PdfPageData = {
  getTextContent(options?: Record<string, unknown>): Promise<PdfTextContent>;
};

type LayoutItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfLayoutTextResult = {
  text: string;
  pageCount: number;
  lineCount: number;
};

function getItemHeight(item: PdfTextItem, transform: number[]) {
  if (typeof item.height === "number" && item.height > 0) return item.height;
  const [, b, , d] = transform;
  return Math.max(1, Math.sqrt(b * b + d * d));
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function clusterRows(items: LayoutItem[]) {
  const rows: LayoutItem[][] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  for (const item of sorted) {
    const tolerance = Math.max(2.5, item.height * 0.55);
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= tolerance);
    if (row) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

function rowToText(row: LayoutItem[]) {
  const parts: string[] = [];
  let previousRight: number | null = null;
  const medianHeight = [...row].sort((a, b) => a.height - b.height)[Math.floor(row.length / 2)]?.height ?? 10;
  const cellGap = Math.max(12, medianHeight * 1.35);

  for (const item of row) {
    if (previousRight != null) {
      const gap = item.x - previousRight;
      if (gap > cellGap) {
        parts.push("\t");
      } else if (gap > medianHeight * 0.25) {
        parts.push(" ");
      }
    }
    parts.push(item.text);
    previousRight = Math.max(previousRight ?? 0, item.x + item.width);
  }

  return parts.join("").replace(/[ \t]+$/g, "");
}

function renderPageText(pageNo: number, items: LayoutItem[]) {
  const rows = clusterRows(items);
  const lines = rows.map(rowToText).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  return [`--- 第 ${pageNo} 页 ---`, ...lines].join("\n");
}

/**
 * 从 PDF 文本层读取坐标，并按 Y/X 坐标恢复行列关系。
 * 这比 pdf-parse 默认纯文本更适合带线框的报价单表格；扫描件仍会返回空文本，由上层回落 OCR。
 */
export async function extractLayoutTextFromPdfBuffer(buffer: Buffer): Promise<PdfLayoutTextResult> {
  const pageTexts: string[] = [];
  let pageNo = 0;

  const result = await pdfParse(buffer, {
    pagerender: async (rawPageData: unknown) => {
      const pageData = rawPageData as PdfPageData;
      pageNo += 1;
      const content = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      const items = (content.items ?? [])
        .map((item): LayoutItem | null => {
          const text = normalizeText(item.str ?? "");
          const transform = item.transform;
          if (!text || !Array.isArray(transform) || transform.length < 6) return null;
          const x = transform[4];
          const y = transform[5];
          const height = getItemHeight(item, transform);
          const width = typeof item.width === "number" && item.width > 0 ? item.width : text.length * height;
          return { text, x, y, width, height };
        })
        .filter((item): item is LayoutItem => item !== null);

      const pageText = renderPageText(pageNo, items);
      pageTexts.push(pageText);
      return pageText;
    },
  });

  const text = pageTexts.filter(Boolean).join("\n\n").trim();
  const lineCount = text ? text.split(/\n/).filter(Boolean).length : 0;

  return {
    text,
    pageCount: result.numpages,
    lineCount,
  };
}
