import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { appLog } from "@/lib/app-log";
import { uploadsDir } from "@/lib/paths";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function contentTypeForFile(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const fileName = path.basename(id);
  const filePath = path.join(uploadsDir, fileName);

  try {
    appLog.info("uploads-download", "GET", { fileName });
    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentTypeForFile(fileName),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    appLog.warn("uploads-download", "not found", { fileName, errorMessage: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "上传文件不存在" }, { status: 404 });
  }
}
