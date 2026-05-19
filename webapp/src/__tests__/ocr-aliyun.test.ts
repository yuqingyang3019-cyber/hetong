import { describe, expect, it } from "vitest";
import { flattenOcrText } from "@/lib/ocr-aliyun";

describe("flattenOcrText", () => {
  it("includes Aliyun table cells as HTML and TSV before full text", () => {
    const text = flattenOcrText({
      content: "报价单全文",
      subImages: [
        {
          tableInfo: {
            tableCount: 1,
            tableDetails: [
              {
                tableId: 0,
                rowCount: 2,
                columnCount: 2,
                cellDetails: [
                  { rowStart: 0, rowEnd: 0, columnStart: 0, columnEnd: 0, cellContent: "品名" },
                  { rowStart: 0, rowEnd: 0, columnStart: 1, columnEnd: 1, cellContent: "数量" },
                  { rowStart: 1, rowEnd: 1, columnStart: 0, columnEnd: 0, cellContent: "水箱" },
                  { rowStart: 1, rowEnd: 1, columnStart: 1, columnEnd: 1, cellContent: "2" },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(text).toContain("[表格 parser=aliyun-ocr subImage=1 index=1]");
    expect(text).toContain("<td>水箱</td>");
    expect(text).toContain("[TSV]\n品名\t数量\n水箱\t2");
    expect(text).toContain("[全文]\n报价单全文");
  });
});
