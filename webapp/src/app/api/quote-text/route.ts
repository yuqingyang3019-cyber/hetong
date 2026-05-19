import { NextResponse } from "next/server";
import { appLog } from "@/lib/app-log";
import { extractTextFromFile } from "@/lib/extract-text";
import { saveUpload } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("quote");

  if (!(file instanceof File)) {
    appLog.warn("quote-text", "reject: no file in formData");
    return NextResponse.json({ error: "请上传报价单文件" }, { status: 400 });
  }

  appLog.info("quote-text", "parse start", {
    fileName: file.name,
    mimeType: file.type || "unknown",
    sizeBytes: file.size,
  });

  try {
    const sourceFile = await saveUpload(file);
    const quoteText = await extractTextFromFile(sourceFile.storedPath, sourceFile.mimeType);

    appLog.info("quote-text", "parse ok", {
      storedPathSuffix: sourceFile.storedPath.slice(-48),
      mimeType: sourceFile.mimeType,
      textLength: quoteText.length,
    });

    return NextResponse.json({
      sourceFile,
      quoteText,
      textLength: quoteText.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "解析报价单失败";
    appLog.error("quote-text", "parse failed", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
