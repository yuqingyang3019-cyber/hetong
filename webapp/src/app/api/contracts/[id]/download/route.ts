import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { appLog } from "@/lib/app-log";
import { findGeneratedContract } from "@/lib/generated-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  appLog.info("contracts-download", "GET", { contractId: id });
  const filePath = await findGeneratedContract(id);
  if (!filePath) {
    appLog.warn("contracts-download", "not found", { contractId: id });
    return NextResponse.json({ error: "合同文件不存在" }, { status: 404 });
  }

  const buffer = await readFile(filePath);
  const fileName = path.basename(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
