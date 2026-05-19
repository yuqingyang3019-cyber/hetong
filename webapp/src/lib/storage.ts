import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { draftsDir, generatedContractsDir, uploadsDir } from "./paths";

export async function ensureStorage() {
  await Promise.all([
    mkdir(uploadsDir, { recursive: true }),
    mkdir(draftsDir, { recursive: true }),
    mkdir(generatedContractsDir, { recursive: true }),
  ]);
}

export function safeFileName(name: string) {
  return name.replace(/[^\w.\-\u4e00-\u9fa5()（）【】]/g, "_");
}

export function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveUpload(file: File) {
  await ensureStorage();
  const id = newId("upload");
  const fileName = `${id}_${safeFileName(file.name)}`;
  const storedPath = path.join(uploadsDir, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(storedPath, buffer);
  return {
    originalName: file.name,
    storedPath,
    mimeType: file.type || "application/octet-stream",
    size: buffer.length,
  };
}
